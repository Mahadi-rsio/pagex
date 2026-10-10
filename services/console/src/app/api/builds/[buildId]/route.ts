import { NextResponse } from "next/server";
import {
    errorMessage,
    errorStatus,
    withApiAuth,
} from "@/server/api/http/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const GET = withApiAuth(async (_request, auth, context) => {
    const { buildId } = await context.params;

    const { getBuildForTenant } = await import(
        "@/features/builds/build.service"
    );
    try {
        return NextResponse.json(await getBuildForTenant(buildId, auth.id));
    } catch (error) {
        console.error("[api/builds] status failed:", error);
        return NextResponse.json(
            { error: errorMessage(error) },
            { status: errorStatus(error) },
        );
    }
});
