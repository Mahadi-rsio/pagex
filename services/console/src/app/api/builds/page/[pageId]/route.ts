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
    const { pageId } = await context.params;

    const { listBuildsForPage } = await import(
        "@/features/builds/build.service"
    );
    try {
        return NextResponse.json(await listBuildsForPage(pageId, auth.id));
    } catch (error) {
        console.error("[api/builds/page] list failed:", error);
        return NextResponse.json(
            { error: errorMessage(error) },
            { status: errorStatus(error) },
        );
    }
});
