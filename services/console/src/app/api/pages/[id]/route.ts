import { NextResponse } from "next/server";
import { withApiAuth } from "@/server/api/http/guard";

interface RouteContext {
    params: Promise<{ id: string }>;
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export const DELETE = withApiAuth(async (_request, auth, context) => {
    const { id } = await context.params;

    const { deletePage } = await import("@/features/projects/page.service");
    try {
        const result = await deletePage(id, auth.id);
        if ("error" in result) {
            return NextResponse.json(result, {
                status: result.error === "Forbidden" ? 403 : 404,
            });
        }
        return NextResponse.json(result);
    } catch (error) {
        console.error(error);
        return NextResponse.json(
            { error: "Internal Server Error" },
            { status: 500 },
        );
    }
});
