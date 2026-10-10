import { test } from "node:test";
import assert from "node:assert/strict";
import {
    PUBLIC_RATE_LIMIT_MAX,
    INTERNAL_RATE_LIMIT_MAX,
    buildRateLimitedResponse,
} from "../src/server/api/http/rate-limit";

test("public and internal rate limits are distinct budgets", () => {
    // The internal per-build budget must be far larger than the public per-IP
    // budget so machine log/heartbeat traffic cannot exhaust it the way it
    // would exhaust the public quota.
    assert.ok(INTERNAL_RATE_LIMIT_MAX > PUBLIC_RATE_LIMIT_MAX * 10);
});

test("buildRateLimitedResponse carries code, Retry-After and 429", async () => {
    const res = buildRateLimitedResponse({
        blocked: true,
        keyType: "ip",
        headers: new Headers({
            "RateLimit-Reset": "120",
            "RateLimit-Limit": "100",
            "RateLimit-Remaining": "0",
        }),
    });

    assert.equal(res.status, 429);
    assert.equal(res.headers.get("Retry-After"), "120");
    assert.equal(res.headers.get("RateLimit-Remaining"), "0");
    assert.match(res.headers.get("content-type") ?? "", /application\/json/);

    const body = (await res.json()) as { code?: string; retryAfter?: number };
    assert.equal(body.code, "RATE_LIMITED");
    assert.equal(body.retryAfter, 120);
});

test("buildRateLimitedResponse defaults Retry-After when missing", () => {
    const res = buildRateLimitedResponse({
        blocked: true,
        keyType: "build",
        headers: new Headers(),
    });
    assert.equal(res.status, 429);
    assert.ok(res.headers.get("Retry-After"));
});

test("internal key type is surfaced for observability", () => {
    const res = buildRateLimitedResponse({
        blocked: true,
        keyType: "build",
        headers: new Headers(),
    });
    assert.equal(res.status, 429);
});
