import { NextResponse } from "next/server";
import { withApiAuth } from "@/server/api/http/guard";

interface RouteContext {
    params: Promise<{ domain: string }>;
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export const GET = withApiAuth(async (_request, _auth, context) => {
    const { domain } = await context.params;

    const { getPageUsage } = await import("@/features/projects/page.service");
    try {
        const usage = await getPageUsage(domain);
        if (!usage) {
            return NextResponse.json(
                { error: "Domain not found" },
                { status: 404 },
            );
        }
        return NextResponse.json(usage);
    } catch (error) {
        console.error("Usage fetch failed for", domain, ":", error);
        return NextResponse.json(
            { error: "Failed to fetch usage" },
            { status: 500 },
        );
    }
});
