import { NextResponse } from "next/server";
import {
    withApiAuth,
    readJsonBody,
    errorStatus,
    errorMessage,
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

    const { prepareDeploy } = await import(
        "@/features/deployments/deploy.service"
    );
    try {
        return NextResponse.json(await prepareDeploy(validation.data, auth.id));
    } catch (error) {
        console.error("deploy.prepare failed:", error);
        return NextResponse.json(
            { error: errorMessage(error) },
            { status: errorStatus(error) },
        );
    }
});
