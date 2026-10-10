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

/**
 * Machine completion. A successful completion must reference a deployment that
 * this build actually produced; the server verifies that linkage, so a buggy or
 * malicious machine cannot attach another project's deployment.
 */
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

    const { completeBuildSchema } = await import(
        "@/features/builds/build.validator"
    );
    const validation = completeBuildSchema.safeParse(body.value);
    if (!validation.success) {
        return NextResponse.json(
            { error: validation.error.format() },
            { status: 400 },
        );
    }

    const { completeBuild } = await import("@/features/builds/build.service");
    try {
        const result = await completeBuild({
            buildId,
            workerId: validation.data.workerId,
            body: validation.data,
        });
        return NextResponse.json(result);
    } catch (error) {
        return NextResponse.json(
            { error: errorMessage(error) },
            { status: errorStatus(error) },
        );
    }
});
