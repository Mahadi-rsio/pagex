import { NextResponse } from "next/server";
import {
    withApiAuth,
    errorStatus,
    errorMessage,
} from "@/server/api/http/guard";

interface RouteContext {
    params: Promise<{ pageId: string }>;
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export const GET = withApiAuth(async (_request, auth, context) => {
    const { pageId } = await context.params;

    const { listDeployments } = await import(
        "@/features/deployments/deployment.service"
    );
    try {
        const result = await listDeployments(pageId, auth.id);
        return NextResponse.json(result);
    } catch (error) {
        console.error("List deployments failed:", error);
        return NextResponse.json(
            { error: errorMessage(error) },
            { status: errorStatus(error) },
        );
    }
});
