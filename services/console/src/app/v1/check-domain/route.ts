import { TOP_LEVEL_DOMAIN } from "@/server/api/constants";
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
            Response.json(
                { error: "Too many requests, please try again later" },
                { status: 429 },
            ),
            rateLimit.headers,
        );
    }

    const domain = new URL(request.url).searchParams.get("domain");
    const response =
        domain?.endsWith(`.${TOP_LEVEL_DOMAIN}`) === true
            ? new Response("OK")
            : new Response("Forbidden", { status: 403 });

    return withRateLimitHeaders(response, rateLimit.headers);
}
