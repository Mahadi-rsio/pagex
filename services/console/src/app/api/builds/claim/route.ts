import { NextResponse } from "next/server";
import { authorizeMachineRequest } from "@/server/api/http/machine-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Machine claim endpoint. The shared Fly build machine calls this after boot
 * (and after each job) to pull exactly one queued build, receiving a
 * short-lived job token in return. Guarded by the shared machine secret.
 *
 * `FOR UPDATE SKIP LOCKED` makes concurrent claims safe, so even if two
 * machines briefly overlap they never run the same job.
 */
export async function POST(request: Request): Promise<Response> {
    const denied = authorizeMachineRequest(request);
    if (denied) return denied;

    let workerId: string | undefined;
    try {
        const body = (await request.json()) as { workerId?: unknown };
        if (typeof body.workerId === "string") workerId = body.workerId;
    } catch {
        /* fall through to validation below */
    }

    const { claimBuildsSchema } = await import(
        "@/features/builds/build.validator"
    );
    const validation = claimBuildsSchema.safeParse({ workerId });
    if (!validation.success) {
        return NextResponse.json(
            { error: validation.error.format() },
            { status: 400 },
        );
    }

    const { claimBuildForWorker } = await import(
        "@/features/builds/build.service"
    );
    try {
        const claimed = await claimBuildForWorker(validation.data.workerId);
        return NextResponse.json({ job: claimed });
    } catch (error) {
        console.error("[api/builds/claim] failed:", error);
        return NextResponse.json(
            { error: "Failed to claim build" },
            { status: 500 },
        );
    }
}
