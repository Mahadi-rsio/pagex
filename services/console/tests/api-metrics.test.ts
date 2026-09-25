import { test } from "node:test";
import assert from "node:assert/strict";

import {
    buildMetricsResponse,
    emptyMetricsInput,
    estimatePercentile,
    resolveMetricsWindow,
    summarizeLatency,
    type LatencyInput,
} from "../src/server/api/utils/metrics";

function latency(partial: Partial<LatencyInput> = {}): LatencyInput {
    return {
        latencySumMs: 0,
        latencyLe50: 0,
        latencyLe100: 0,
        latencyLe250: 0,
        latencyLe500: 0,
        latencyLe1000: 0,
        latencyLe2500: 0,
        ...partial,
    };
}

test("estimatePercentile returns the smallest covering bound", () => {
    // 100 requests, all <= 50ms.
    const input = latency({
        latencyLe50: 100,
        latencyLe100: 100,
        latencyLe250: 100,
        latencyLe500: 100,
        latencyLe1000: 100,
        latencyLe2500: 100,
    });
    assert.equal(estimatePercentile(input, 100, 50), 50);
    assert.equal(estimatePercentile(input, 100, 99), 50);
});

test("estimatePercentile walks cumulative buckets", () => {
    // 90 fast (<=50ms), 10 slow (<=250ms): p50=50, p95=250, p99=250.
    const input = latency({
        latencyLe50: 90,
        latencyLe100: 90,
        latencyLe250: 100,
        latencyLe500: 100,
        latencyLe1000: 100,
        latencyLe2500: 100,
    });
    assert.equal(estimatePercentile(input, 100, 50), 50);
    assert.equal(estimatePercentile(input, 100, 95), 250);
    assert.equal(estimatePercentile(input, 100, 99), 250);
});

test("estimatePercentile returns null when slower than the largest bound", () => {
    // 10 requests, none in any bucket -> every request > 2500ms.
    const input = latency();
    assert.equal(estimatePercentile(input, 10, 50), null);
});

test("estimatePercentile returns null with no requests", () => {
    assert.equal(estimatePercentile(latency(), 0, 50), null);
});

test("summarizeLatency computes the average from the sum", () => {
    const summary = summarizeLatency(
        latency({
            latencySumMs: 1000,
            latencyLe50: 10,
            latencyLe100: 10,
            latencyLe250: 10,
            latencyLe500: 10,
            latencyLe1000: 10,
            latencyLe2500: 10,
        }),
        10,
    );
    assert.equal(summary.averageMs, 100);
    assert.equal(summary.samples, 10);
});

test("buildMetricsResponse separates cache and status dimensions", () => {
    const res = buildMetricsResponse({
        ...emptyMetricsInput(),
        requests: 4,
        status2xx: 3,
        status4xx: 1,
        bytes: 1234,
        cacheHits: 3,
        cacheMisses: 1,
        latencySumMs: 400,
        latencyLe100: 4,
    });
    assert.equal(res.requests, 4);
    assert.equal(res.bandwidthBytes, 1234);
    assert.equal(res.status["2xx"], 3);
    assert.equal(res.status["4xx"], 1);
    assert.equal(res.cache.hits, 3);
    assert.equal(res.cache.misses, 1);
    assert.equal(res.cache.hitRate, 75);
    assert.equal(res.latency.averageMs, 100);
});

test("buildMetricsResponse handles a zero-traffic window", () => {
    const res = buildMetricsResponse(emptyMetricsInput());
    assert.equal(res.requests, 0);
    assert.equal(res.cache.hitRate, null);
    assert.equal(res.latency.averageMs, null);
    assert.equal(res.latency.p99, null);
});

test("resolveMetricsWindow defaults to the last 24h", () => {
    const now = new Date("2026-09-23T12:00:00Z");
    const { start, end } = resolveMetricsWindow({}, now);
    assert.equal(end.toISOString(), "2026-09-23T12:00:00.000Z");
    assert.equal(start.toISOString(), "2026-09-22T12:00:00.000Z");
});

test("resolveMetricsWindow honours named windows", () => {
    const now = new Date("2026-09-23T12:00:00Z");
    assert.equal(
        resolveMetricsWindow({ window: "1h" }, now).start.toISOString(),
        "2026-09-23T11:00:00.000Z",
    );
    assert.equal(
        resolveMetricsWindow({ window: "7d" }, now).start.toISOString(),
        "2026-09-16T12:00:00.000Z",
    );
});

test("resolveMetricsWindow clamps the span to 31 days", () => {
    const now = new Date("2026-09-23T12:00:00Z");
    const { start } = resolveMetricsWindow(
        { from: "2026-01-01T00:00:00Z", to: now.toISOString() },
        now,
    );
    assert.equal(start.toISOString(), "2026-08-23T12:00:00.000Z");
});
