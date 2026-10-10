import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

/**
 * Machine authentication for the internal build endpoints (`/api/builds/claim`
 * and `/api/internal/builds/controller`).
 *
 * These endpoints are used by the shared Fly build machine *before* it has a
 * per-job token, so they are guarded by a single high-entropy shared secret
 * (`BUILD_MACHINE_TOKEN`). The token lives only in the machine's process env —
 * it is never passed to project build scripts — and never grants access to a
 * tenant's data beyond claiming its own next queued job.
 */

function constantTimeEqual(a: string, b: string): boolean {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    if (bufA.length !== bufB.length) return false;
    return timingSafeEqual(bufA, bufB);
}

export function readMachineToken(
    env: NodeJS.ProcessEnv = process.env,
): string | null {
    const token = env.BUILD_MACHINE_TOKEN;
    return token && token.length >= 32 ? token : null;
}

/** Verify the bearer token against the configured machine secret. */
export function authorizeMachineRequest(request: Request): Response | null {
    const expected = readMachineToken();
    if (!expected) {
        return NextResponse.json(
            { error: "Build machine is not configured" },
            { status: 503 },
        );
    }

    const authorization = request.headers.get("authorization");
    const [scheme, token, extra] = authorization?.trim().split(/\s+/) ?? [];
    if (scheme !== "Bearer" || !token || extra) {
        return NextResponse.json(
            { error: "Missing or invalid machine authorization" },
            { status: 401 },
        );
    }

    if (!constantTimeEqual(token, expected)) {
        return NextResponse.json(
            { error: "Missing or invalid machine authorization" },
            { status: 401 },
        );
    }

    return null;
}
