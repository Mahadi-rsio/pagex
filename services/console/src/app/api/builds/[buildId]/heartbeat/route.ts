import { NextResponse } from "next/server";
import {
    errorMessage,
    errorStatus,
    readJsonBody,
    withApiAuth,
} from "@/server/api/http/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Machine heartbeat: renew the lease on the claimed build. */
export const POST = withApiAuth(async (request, auth, context) => {
    const { buildId } = await context.params;

    if (!auth.job || auth.job.buildId !== buildId) {
        return NextResponse.json(
            { error: "A build job token is required" },
            { status: 403 },
        );
    }

    const body = await readJsonBody<unknown>(request);
    if (!body.ok) return body.response;

    const { heartbeatBuildSchema } = await import(
        "@/features/builds/build.validator"
    );
    const validation = heartbeatBuildSchema.safeParse(body.value);
    if (!validation.success) {
        return NextResponse.json(
            { error: validation.error.format() },
            { status: 400 },
        );
    }

    const { heartbeatBuild } = await import("@/features/builds/build.service");
    try {
        await heartbeatBuild(buildId, validation.data.workerId);
        return NextResponse.json({ ok: true });
    } catch (error) {
        return NextResponse.json(
            { error: errorMessage(error) },
            { status: errorStatus(error) },
        );
    }
});
