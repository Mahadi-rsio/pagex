import { NextResponse } from "next/server";
import {
    checkPublicRateLimit,
    withRateLimitHeaders,
} from "@/server/api/http/rate-limit";
import { log, structuredLog } from "@/server/api/http/request-log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
    const startedAt = Date.now();
    const rateLimit = await checkPublicRateLimit(request);
    if (rateLimit.blocked) {
        structuredLog.warn({
            route: "GET /health",
            statusCode: 429,
            durationMs: Date.now() - startedAt,
            rateLimitDecision: "blocked",
            rateLimitKeyType: rateLimit.keyType,
        });
        return withRateLimitHeaders(
            NextResponse.json(
                { error: "Too many requests, please try again later" },
                { status: 429 },
            ),
            rateLimit.headers,
        );
    }

    const body = {
        message: "ok",
        deploymentRevision:
            process.env.CF_PAGES_DEPLOYMENT_ID ||
            process.env.CF_REVISION_ID ||
            "local",
        environment:
            process.env.ENVIRONMENT || process.env.NODE_ENV || "development",
    };
    log({
        route: "GET /health",
        statusCode: 200,
        durationMs: Date.now() - startedAt,
        rateLimitDecision: "allowed",
        rateLimitKeyType: rateLimit.keyType,
    });

    return withRateLimitHeaders(NextResponse.json(body), rateLimit.headers);
}
