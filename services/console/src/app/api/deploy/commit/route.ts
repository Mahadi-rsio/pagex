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

    const { commitDeploySchema } = await import(
        "@/features/deployments/deploy.validator"
    );
    const validation = commitDeploySchema.safeParse(body.value);
    if (!validation.success) {
        return NextResponse.json(
            { error: validation.error.format() },
            { status: 400 },
        );
    }

    const { commitDeploy } = await import(
        "@/features/deployments/deploy.service"
    );
    try {
        return NextResponse.json(
            await commitDeploy(
                validation.data,
                auth.id,
                auth.job ? { expectedPageId: auth.job.pageId } : undefined,
            ),
        );
    } catch (error) {
        console.error("[api/deploy/commit] failed", {
            tenant_id: auth.id,
            idempotency_key: validation.data.idempotencyKey ?? null,
            has_deployment_token: Boolean(validation.data.deploymentToken),
            error: errorDetails(error),
        });
        return NextResponse.json(
            { error: errorMessage(error) },
            { status: errorStatus(error) },
        );
    }
});
