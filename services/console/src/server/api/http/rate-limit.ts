import { RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS } from "../constants/index";

const RATE_LIMIT_SCRIPT = `
local count = redis.call("INCR", KEYS[1])
if count == 1 then
    redis.call("PEXPIRE", KEYS[1], ARGV[1])
end
local ttl = redis.call("PTTL", KEYS[1])
return { count, ttl }
`;

export interface RateLimitResult {
    blocked: boolean;
    headers: Headers;
}

function clientIdentifier(request: Request): string {
    const forwarded = request.headers.get("x-forwarded-for");
    if (forwarded) return forwarded.split(",")[0]?.trim() || "unknown";

    return (
        request.headers.get("x-real-ip")?.trim() ||
        request.headers.get("cf-connecting-ip")?.trim() ||
        "unknown"
    );
}

function buildHeaders(count: number, ttl: number): Headers {
    const remaining = Math.max(0, RATE_LIMIT_MAX - count);
    const reset = Math.max(0, Math.ceil(ttl / 1000));

    return new Headers({
        "RateLimit-Limit": String(RATE_LIMIT_MAX),
        "RateLimit-Remaining": String(remaining),
        "RateLimit-Reset": String(reset),
        "RateLimit-Policy": `${RATE_LIMIT_MAX};w=${Math.ceil(RATE_LIMIT_WINDOW_MS / 1000)}`,
    });
}

export async function checkPublicRateLimit(
    request: Request,
): Promise<RateLimitResult> {
    const { redis } = await import("../infrastructure/cache/redis");

    try {
        const identifier = clientIdentifier(request);
        const result = await redis.eval(
            RATE_LIMIT_SCRIPT,
            1,
            `rate-limit:${identifier}`,
            String(RATE_LIMIT_WINDOW_MS),
        );

        if (!Array.isArray(result) || result.length < 2) {
            return { blocked: false, headers: new Headers() };
        }

        const count = Number(result[0]);
        const ttl = Number(result[1]);
        return {
            blocked: count > RATE_LIMIT_MAX,
            headers: buildHeaders(count, ttl),
        };
    } catch (error) {
        console.error("Rate limit check failed:", error);
        return { blocked: false, headers: new Headers() };
    }
}

export function withRateLimitHeaders(
    response: Response,
    headers: Headers,
): Response {
    const next = new Response(response.body, response);
    headers.forEach((value, key) => next.headers.set(key, value));
    return next;
}
