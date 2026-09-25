import { NextResponse } from "next/server";
import {
    withApiAuth,
    errorStatus,
    errorMessage,
} from "@/server/api/http/guard";

interface RouteContext {
    params: Promise<{ deploymentId: string }>;
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export const POST = withApiAuth(async (_request, auth, context) => {
    const { deploymentId } = await context.params;

    const { rollbackToDeployment } = await import(
        "@/features/deployments/deployment.service"
    );
    try {
        const deployment = await rollbackToDeployment(deploymentId, auth.id);
        return NextResponse.json({
            success: true,
            message: "Rollback successful",
            deployment,
        });
    } catch (error) {
        console.error("Rollback failed:", error);
        return NextResponse.json(
            { error: errorMessage(error) },
            { status: errorStatus(error) },
        );
    }
});
