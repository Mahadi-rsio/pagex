import { test } from "node:test";
import assert from "node:assert/strict";

import {
    BYTES_PER_GB,
    getPlan,
    PLANS,
} from "../src/server/api/constants/pricing";
import {
    buildUsageResponse,
    bytesToGB,
    computeBandwidthUsage,
    currentUsageWindow,
    gbToBytes,
    isOverQuota,
    periodKey,
} from "../src/server/api/utils/usage";

test("uses decimal GB (1 GB = 1_000_000_000 bytes)", () => {
    assert.equal(BYTES_PER_GB, 1_000_000_000);
    assert.equal(gbToBytes(1), 1_000_000_000);
    assert.equal(bytesToGB(1_000_000_000), 1);
});

test("plan catalogue matches the product limits", () => {
    assert.equal(PLANS.free.bandwidthLimitBytes, 100 * BYTES_PER_GB);
    assert.equal(PLANS.paid.bandwidthLimitBytes, 500 * BYTES_PER_GB);
    // No request dimension exists anywhere in a plan.
    assert.equal("requestLimit" in PLANS.free, false);
});

test("unknown or missing plans fall back to free", () => {
    assert.equal(getPlan(undefined).id, "free");
    assert.equal(getPlan(null).id, "free");
    assert.equal(getPlan("enterprise").id, "free");
    assert.equal(getPlan("paid").id, "paid");
});

test("computeBandwidthUsage reports percentage and remaining", () => {
    const half = computeBandwidthUsage("free", 50 * BYTES_PER_GB);
    assert.equal(half.unlimited, false);
    assert.equal(half.limitBytes, 100 * BYTES_PER_GB);
    assert.equal(half.remainingBytes, 50 * BYTES_PER_GB);
    assert.equal(half.percentage, 50);
    assert.equal(half.overQuota, false);
});

test("computeBandwidthUsage clamps remaining and flags over-quota", () => {
    const over = computeBandwidthUsage("free", 120 * BYTES_PER_GB);
    assert.equal(over.remainingBytes, 0);
    assert.equal(over.overQuota, true);
    assert.equal(over.percentage, 120);
});

test("computeBandwidthUsage never returns a request field", () => {
    const usage = computeBandwidthUsage("free", 1) as unknown as Record<
        string,
        unknown
    >;
    assert.equal("requests" in usage, false);
    assert.equal("requestLimit" in usage, false);
});

test("isOverQuota is true exactly at the limit", () => {
    assert.equal(isOverQuota("paid", 500 * BYTES_PER_GB - 1), false);
    assert.equal(isOverQuota("paid", 500 * BYTES_PER_GB), true);
});

test("negative or non-finite usage is normalised to 0", () => {
    assert.equal(computeBandwidthUsage("free", -100).usedBytes, 0);
    assert.equal(computeBandwidthUsage("free", Number.NaN).usedBytes, 0);
});

test("usage window is the current UTC calendar month", () => {
    const window = currentUsageWindow(new Date("2026-09-23T14:05:00Z"));
    assert.equal(window.start.toISOString(), "2026-09-01T00:00:00.000Z");
    assert.equal(window.end.toISOString(), "2026-10-01T00:00:00.000Z");
    assert.equal(periodKey(window), "2026-09");
});

test("buildUsageResponse exposes bandwidth only and ISO period bounds", () => {
    const res = buildUsageResponse(
        "free",
        25 * BYTES_PER_GB,
        currentUsageWindow(new Date("2026-09-23T00:00:00Z")),
    );
    assert.equal(res.period.key, "2026-09");
    assert.equal(res.period.start, "2026-09-01T00:00:00.000Z");
    assert.equal(res.period.end, "2026-10-01T00:00:00.000Z");
    assert.equal(res.plan, "free");
    assert.equal(res.bandwidth.usedBytes, 25 * BYTES_PER_GB);
    assert.equal(res.bandwidth.limitBytes, 100 * BYTES_PER_GB);
    assert.equal(res.bandwidth.percentage, 25);
    // Requests are unlimited and must not appear in the response contract.
    assert.equal(JSON.stringify(res).includes("request"), false);
});
