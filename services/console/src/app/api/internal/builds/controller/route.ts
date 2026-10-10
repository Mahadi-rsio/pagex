import { NextResponse } from "next/server";
import { authorizeMachineRequest } from "@/server/api/http/machine-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Build machine controller tick (machine-authenticated).
 *
 * Reconciles stale leases, then starts or stops the shared Fly machine based on
 * whether work exists. Intended to be called periodically by a cron/supervisor
 * and by the machine itself before it exits. Idempotent and lock-guarded.
 */
export async function POST(request: Request): Promise<Response> {
    const denied = authorizeMachineRequest(request);
    if (denied) return denied;

    const { reconcileBuilds } = await import("@/features/builds/build.service");
    const { runBuildControllerTick } = await import(
        "@/features/builds/fly.controller"
    );

    try {
        const reconciled = await reconcileBuilds();
        const action = await runBuildControllerTick();
        return NextResponse.json({ reconciled, action });
    } catch (error) {
        console.error("[api/internal/builds/controller] failed:", error);
        return NextResponse.json(
            { error: "Controller tick failed" },
            { status: 500 },
        );
    }
}
