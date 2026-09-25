import { NextResponse } from "next/server";
import {
    checkPublicRateLimit,
    withRateLimitHeaders,
} from "@/server/api/http/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
    const rateLimit = await checkPublicRateLimit(request);
    if (rateLimit.blocked) {
        return withRateLimitHeaders(
            NextResponse.json(
                { error: "Too many requests, please try again later" },
                { status: 429 },
            ),
            rateLimit.headers,
        );
    }

    return withRateLimitHeaders(
        NextResponse.json({ message: "ok" }),
        rateLimit.headers,
    );
}
