import { RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS } from "../constants/index";

/**
 * Shared rate limiting for the console API.
 *
 * Two distinct policies exist so machine-to-console traffic never competes
 * with public tenant traffic for the same quota:
 *
 *  - `checkPublicRateLimit`: keyed by client IP. Applied to authenticated
 *    tenant requests and to unauthenticated requests (anti-abuse).
 *  - `checkInternalRateLimit`: keyed by an authenticated identity (build id /
 *    machine token hash) instead of a shared egress IP. Applied to build
 *    runner job-token requests, which otherwise all originate from one Fly
 *    machine egress IP and would starve each other under the public quota.
 *
 * Both use the same atomic INCR+TTL Lua script; only the key and limits differ.
 */

const RATE_LIMIT_SCRIPT = `
local count = redis.call("INCR", KEYS[1])
if count == 1 then
    redis.call("PEXPIRE", KEYS[1], ARGV[1])
end
local ttl = redis.call("PTTL", KEYS[1])
return { count, ttl }
`;

/** Public per-IP budget (unchanged): 100 requests / 15 minutes. */
export const PUBLIC_RATE_LIMIT_MAX = RATE_LIMIT_MAX;
export const PUBLIC_RATE_LIMIT_WINDOW_MS = RATE_LIMIT_WINDOW_MS;

/**
 * Internal per-build budget for machine job-token requests. This is large
 * enough to absorb batched log flushes, heartbeats and completion calls from a
 * single build without being unbounded, and it is keyed per build so one noisy
 * build cannot starve another.
 */
export const INTERNAL_RATE_LIMIT_MAX = 5_000;
export const INTERNAL_RATE_LIMIT_WINDOW_MS = RATE_LIMIT_WINDOW_MS;

export interface RateLimitResult {
    blocked: boolean;
    headers: Headers;
}

/** Type of quota key, surfaced in structured logs (never the raw key). */
export type RateLimitKeyType = "ip" | "build" | "none";

export interface RateLimitDecision extends RateLimitResult {
    keyType: RateLimitKeyType;
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

function buildHeaders(
    count: number,
    ttl: number,
    limit: number,
    windowMs: number,
): Headers {
    const remaining = Math.max(0, limit - count);
    const reset = Math.max(0, Math.ceil(ttl / 1000));

    return new Headers({
        "RateLimit-Limit": String(limit),
        "RateLimit-Remaining": String(remaining),
        "RateLimit-Reset": String(reset),
        "RateLimit-Policy": `${limit};w=${Math.ceil(windowMs / 1000)}`,
    });
}

async function evaluate(
    key: string,
    limit: number,
    windowMs: number,
): Promise<{ count: number; ttl: number } | null> {
    const { redis, redisKey } = await import("../infrastructure/cache/redis");
    try {
        const result = await redis.eval<[string], [number, number]>(
            RATE_LIMIT_SCRIPT,
            [redisKey(key)],
            [String(windowMs)],
        );
        if (!Array.isArray(result) || result.length < 2) return null;
        return { count: Number(result[0]), ttl: Number(result[1]) };
    } catch {
        // A Redis outage must fail open for availability; the request is
        // still bounded by authentication/authorization.
        return null;
    }
}

/**
 * Public per-IP limiter. On Redis failure it fails open (returns a
 * non-blocking decision) rather than taking the site down.
 */
export async function checkPublicRateLimit(
    request: Request,
): Promise<RateLimitDecision> {
    const identifier = clientIdentifier(request);
    const state = await evaluate(
        `rate-limit:ip:${identifier}`,
        PUBLIC_RATE_LIMIT_MAX,
        PUBLIC_RATE_LIMIT_WINDOW_MS,
    );

    if (!state)
        return { blocked: false, headers: new Headers(), keyType: "none" };

    return {
        blocked: state.count > PUBLIC_RATE_LIMIT_MAX,
        headers: buildHeaders(
            state.count,
            state.ttl,
            PUBLIC_RATE_LIMIT_MAX,
            PUBLIC_RATE_LIMIT_WINDOW_MS,
        ),
        keyType: "ip",
    };
}

/**
 * Internal per-build limiter for machine job-token requests. `buildId` is a
 * short-lived, unguessable UUID unique to one build, so it is a safe quota key
 * that does not couple unrelated builds to a shared egress IP.
 */
export async function checkInternalRateLimit(
    buildId: string,
): Promise<RateLimitDecision> {
    const state = await evaluate(
        `rate-limit:build:${buildId}`,
        INTERNAL_RATE_LIMIT_MAX,
        INTERNAL_RATE_LIMIT_WINDOW_MS,
    );

    if (!state)
        return { blocked: false, headers: new Headers(), keyType: "none" };

    return {
        blocked: state.count > INTERNAL_RATE_LIMIT_MAX,
        headers: buildHeaders(
            state.count,
            state.ttl,
            INTERNAL_RATE_LIMIT_MAX,
            INTERNAL_RATE_LIMIT_WINDOW_MS,
        ),
        keyType: "build",
    };
}

/** Apply rate-limit headers to an existing response (compat for simple routes). */
export function withRateLimitHeaders(
    response: Response,
    headers: Headers,
): Response {
    const next = new Response(response.body, response);
    headers.forEach((value, key) => next.headers.set(key, value));
    return next;
}

/** Build a 429 response with a machine-readable error code and Retry-After. */
export function buildRateLimitedResponse(
    decision: RateLimitDecision,
): Response {
    const retryAfter = decision.headers.get("RateLimit-Reset") ?? "60";
    const headers = new Headers(decision.headers);
    headers.set("Retry-After", retryAfter);
    headers.set("Content-Type", "application/json");

    return new Response(
        JSON.stringify({
            error: "Too many requests, please try again later",
            code: "RATE_LIMITED",
            retryAfter: Number(retryAfter),
        }),
        { status: 429, headers },
    );
}
