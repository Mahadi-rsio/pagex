import { NextResponse } from "next/server";
import { withApiAuth } from "@/server/api/http/guard";

const UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface RouteContext {
    params: Promise<{ siteId: string }>;
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export const GET = withApiAuth(async (request, auth, context) => {
    const { siteId } = await context.params;
    if (!UUID_RE.test(siteId)) {
        return NextResponse.json(
            { error: "Invalid site id" },
            { status: 400 },
        );
    }

    const url = new URL(request.url);
    const query: { window?: string; from?: string; to?: string } = {};
    const window = url.searchParams.get("window");
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    if (window !== null) query.window = window;
    if (from !== null) query.from = from;
    if (to !== null) query.to = to;

    const [{ getSiteMetrics }, { resolveMetricsWindow }] =
        await Promise.all([
            import("@/features/usage/usage.service"),
            import("@/server/api/utils/metrics"),
        ]);
    const metricsWindow = resolveMetricsWindow(query);
    try {
        const metrics = await getSiteMetrics(siteId, auth.id, metricsWindow);
        if (!metrics) {
            return NextResponse.json(
                { error: "Site not found" },
                { status: 404 },
            );
        }
        return NextResponse.json({
            ...metrics,
            window: {
                start: metricsWindow.start.toISOString(),
                end: metricsWindow.end.toISOString(),
            },
        });
    } catch (error) {
        console.error("Site metrics failed:", error);
        return NextResponse.json(
            { error: "Failed to fetch metrics" },
            { status: 500 },
        );
    }
});
