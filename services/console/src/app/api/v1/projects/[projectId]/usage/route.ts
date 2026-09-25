import { NextResponse } from "next/server";
import { withApiAuth } from "@/server/api/http/guard";

const UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface RouteContext {
    params: Promise<{ projectId: string }>;
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export const GET = withApiAuth(async (_request, auth, context) => {
    const { projectId } = await context.params;
    if (!UUID_RE.test(projectId)) {
        return NextResponse.json(
            { error: "Invalid project id" },
            { status: 400 },
        );
    }

    const { getProjectUsage } = await import(
        "@/features/usage/usage.service"
    );
    try {
        const usage = await getProjectUsage(projectId, auth.id);
        if (!usage) {
            return NextResponse.json(
                { error: "Project not found" },
                { status: 404 },
            );
        }
        return NextResponse.json(usage);
    } catch (error) {
        console.error("Usage fetch failed:", error);
        return NextResponse.json(
            { error: "Failed to fetch usage" },
            { status: 500 },
        );
    }
});
