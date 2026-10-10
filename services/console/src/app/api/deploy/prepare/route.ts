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
export const maxDuration = 300;

export const POST = withApiAuth(async (request, auth) => {
    const body = await readJsonBody<unknown>(request);
    if (!body.ok) return body.response;

    const { prepareDeploySchema } = await import(
        "@/features/deployments/deploy.validator"
    );
    const validation = prepareDeploySchema.safeParse(body.value);
    if (!validation.success) {
        return NextResponse.json(
            { error: validation.error.format() },
            { status: 400 },
        );
    }

    // A build job token may only deploy to the project it was issued for.
    if (auth.job && auth.job.pageId !== validation.data.pageId) {
        return NextResponse.json(
            { error: "Build token is not valid for this project" },
            { status: 403 },
        );
    }

    const { prepareDeploy } = await import(
        "@/features/deployments/deploy.service"
    );
    try {
        return NextResponse.json(
            await prepareDeploy(
                validation.data,
                auth.id,
                auth.job ? { buildId: auth.job.buildId } : undefined,
            ),
        );
    } catch (error) {
        console.error("[api/deploy/prepare] failed", {
            tenant_id: auth.id,
            page_id: validation.data.pageId,
            file_count: validation.data.files.length,
            idempotency_key: validation.data.idempotencyKey ?? null,
            error: errorDetails(error),
        });
        return NextResponse.json(
            { error: errorMessage(error) },
            { status: errorStatus(error) },
        );
    }
});
