import { NextResponse } from "next/server";
import {
    errorDetails,
    errorMessage,
    errorStatus,
    readJsonBody,
    withApiAuth,
} from "@/server/api/http/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Enqueue a remote build for a project owned by the caller.
 *
 * The response is the authoritative `builds` row (status `queued`). The build
 * itself runs on the shared Fly machine; clients poll `/api/builds/[buildId]`
 * or subscribe to `/api/builds/[buildId]/logs`.
 */
export const POST = withApiAuth(async (request, auth) => {
    const body = await readJsonBody<unknown>(request);
    if (!body.ok) return body.response;

    const { createBuildSchema } = await import(
        "@/features/builds/build.validator"
    );
    const validation = createBuildSchema.safeParse(body.value);
    if (!validation.success) {
        return NextResponse.json(
            { error: validation.error.format() },
            { status: 400 },
        );
    }

    const { createBuildJob, acquirePageBuildLock, releasePageBuildLock } =
        await import("@/features/builds/build.service");
    try {
        // Advisory per-page lock: reject a second build while one is in flight
        // instead of silently stacking duplicate work.
        const locked = await acquirePageBuildLock(validation.data.pageId);
        if (!locked) {
            return NextResponse.json(
                { error: "A build is already in progress for this project" },
                { status: 409 },
            );
        }
        const build = await createBuildJob(validation.data, auth.id);
        return NextResponse.json(build, { status: 202 });
    } catch (error) {
        // If the build never got recorded, give up the lock so a corrected
        // retry is not blocked for the lock's full TTL.
        await releasePageBuildLock(validation.data.pageId);
        console.error("[api/builds] create failed", {
            tenant_id: auth.id,
            page_id: validation.data.pageId,
            error: errorDetails(error),
        });
        return NextResponse.json(
            { error: errorMessage(error) },
            { status: errorStatus(error) },
        );
    }
});
