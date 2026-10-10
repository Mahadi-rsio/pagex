import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { authorizeMachineRequest } from "@/server/api/http/machine-auth";
import { structuredLog } from "@/server/api/http/request-log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Build machine controller tick (machine-authenticated).
 *
 * Reconciles stale leases, then starts or stops the shared Fly machine based on
 * whether work exists. Intended to be called periodically by a cron/supervisor
 * and by the machine itself before it exits. Idempotent and lock-guarded.
 *
 * The two stages are isolated so a failure in one (e.g. an upstream Fly error
 * while starting the machine) does not mask the result of the other, and so one
 * bad stage does not turn the whole tick into a generic 500 with no signal.
 * Each stage is logged with a correlation id, outcome and duration.
 */
export async function POST(request: Request): Promise<Response> {
    const correlationId =
        request.headers.get("x-correlation-id") || randomUUID();

    const denied = authorizeMachineRequest(request);
    if (denied) return denied;

    const { reconcileBuilds } = await import("@/features/builds/build.service");
    const { runBuildControllerTick } = await import(
        "@/features/builds/fly.controller"
    );

    const result: {
        reconcile?:
            | { ok: true; value: { requeued: number; failed: number } }
            | { ok: false; error: string };
        action?: { ok: true; value: string } | { ok: false; error: string };
    } = {};

    const reconcileStart = Date.now();
    try {
        const reconciled = await reconcileBuilds();
        result.reconcile = { ok: true, value: reconciled };
        structuredLog.info({
            correlationId,
            stage: "reconcile",
            outcome: "ok",
            durationMs: Date.now() - reconcileStart,
            requeued: reconciled.requeued,
            failed: reconciled.failed,
        });
    } catch (error) {
        result.reconcile = {
            ok: false,
            error: error instanceof Error ? error.message : "reconcile failed",
        };
        structuredLog.error({
            correlationId,
            stage: "reconcile",
            outcome: "error",
            durationMs: Date.now() - reconcileStart,
            error,
        });
    }

    const tickStart = Date.now();
    try {
        const action = await runBuildControllerTick();
        result.action = { ok: true, value: action };
        structuredLog.info({
            correlationId,
            stage: "controller-tick",
            outcome: "ok",
            durationMs: Date.now() - tickStart,
            machineAction: action,
        });
    } catch (error) {
        result.action = {
            ok: false,
            error:
                error instanceof Error
                    ? error.message
                    : "controller tick failed",
        };
        structuredLog.error({
            correlationId,
            stage: "controller-tick",
            outcome: "error",
            durationMs: Date.now() - tickStart,
            error,
        });
    }

    const reconcileOk = result.reconcile?.ok ?? false;
    const actionOk = result.action?.ok ?? false;

    // Only a fully successful tick is a 200. A partial failure returns 500 but
    // still carries the per-stage result so the caller can see exactly which
    // stage failed instead of a single opaque message.
    if (!reconcileOk || !actionOk) {
        return NextResponse.json(
            {
                code: "CONTROLLER_PARTIAL_FAILURE",
                correlationId,
                ...(result.reconcile?.ok
                    ? { reconcile: result.reconcile.value }
                    : { reconcile: { error: result.reconcile?.error } }),
                ...(result.action?.ok
                    ? { action: result.action.value }
                    : { action: { error: result.action?.error } }),
            },
            { status: 500 },
        );
    }

    return NextResponse.json({
        reconciled: (
            result.reconcile as { value: { requeued: number; failed: number } }
        ).value,
        action: (result.action as { value: string }).value,
        correlationId,
    });
}
