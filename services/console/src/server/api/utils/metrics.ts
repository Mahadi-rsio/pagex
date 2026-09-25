/**
 * Pure operational-metrics helpers. No DB or Redis imports.
 *
 * Latency is aggregated as a cumulative histogram (each request increments every
 * bound >= its duration). Percentiles are estimated from those counts, so raw
 * per-request timings are never stored.
 */

export const LATENCY_BOUNDS_MS = [50, 100, 250, 500, 1000, 2500] as const;

export interface LatencyInput {
    latencySumMs: number;
    latencyLe50: number;
    latencyLe100: number;
    latencyLe250: number;
    latencyLe500: number;
    latencyLe1000: number;
    latencyLe2500: number;
}

export interface LatencySummary {
    averageMs: number | null;
    p50: number | null;
    p95: number | null;
    p99: number | null;
    /** Requests observed by the histogram (bounded by the largest bucket). */
    samples: number;
}

function cumulativePairs(
    input: LatencyInput,
): Array<{ bound: number; count: number }> {
    return [
        { bound: 50, count: input.latencyLe50 },
        { bound: 100, count: input.latencyLe100 },
        { bound: 250, count: input.latencyLe250 },
        { bound: 500, count: input.latencyLe500 },
        { bound: 1000, count: input.latencyLe1000 },
        { bound: 2500, count: input.latencyLe2500 },
    ];
}

/**
 * Estimate a percentile (0–100) from the cumulative histogram.
 * Returns the smallest bound at or above the percentile, or `null` when every
 * observation is slower than the largest bound or no requests were recorded.
 */
export function estimatePercentile(
    input: LatencyInput,
    requests: number,
    percentile: number,
): number | null {
    if (requests <= 0) return null;
    const target = (percentile / 100) * requests;

    for (const { bound, count } of cumulativePairs(input)) {
        if (count >= target) return bound;
    }
    return null;
}

export function summarizeLatency(
    input: LatencyInput,
    requests: number,
): LatencySummary {
    const samples = input.latencyLe2500;
    return {
        averageMs:
            requests > 0
                ? Number((input.latencySumMs / requests).toFixed(2))
                : null,
        p50: estimatePercentile(input, requests, 50),
        p95: estimatePercentile(input, requests, 95),
        p99: estimatePercentile(input, requests, 99),
        samples,
    };
}

export interface MetricsInput {
    requests: number;
    status2xx: number;
    status3xx: number;
    status4xx: number;
    status5xx: number;
    bytes: number;
    cacheHits: number;
    cacheMisses: number;
    latencySumMs: number;
    latencyLe50: number;
    latencyLe100: number;
    latencyLe250: number;
    latencyLe500: number;
    latencyLe1000: number;
    latencyLe2500: number;
}

export interface MetricsResponse {
    requests: number;
    bandwidthBytes: number;
    status: { "2xx": number; "3xx": number; "4xx": number; "5xx": number };
    cache: { hits: number; misses: number; hitRate: number | null };
    latency: LatencySummary;
}

/** Build the public operational-metrics response. Requests are not a quota here. */
export function buildMetricsResponse(input: MetricsInput): MetricsResponse {
    const cacheTotal = input.cacheHits + input.cacheMisses;
    return {
        requests: input.requests,
        bandwidthBytes: input.bytes,
        status: {
            "2xx": input.status2xx,
            "3xx": input.status3xx,
            "4xx": input.status4xx,
            "5xx": input.status5xx,
        },
        cache: {
            hits: input.cacheHits,
            misses: input.cacheMisses,
            hitRate:
                cacheTotal > 0
                    ? Number(((input.cacheHits / cacheTotal) * 100).toFixed(2))
                    : null,
        },
        latency: summarizeLatency(input, input.requests),
    };
}

/** Zero-value metrics input, used when a site has no rows in a window. */
export function emptyMetricsInput(): MetricsInput {
    return {
        requests: 0,
        status2xx: 0,
        status3xx: 0,
        status4xx: 0,
        status5xx: 0,
        bytes: 0,
        cacheHits: 0,
        cacheMisses: 0,
        latencySumMs: 0,
        latencyLe50: 0,
        latencyLe100: 0,
        latencyLe250: 0,
        latencyLe500: 0,
        latencyLe1000: 0,
        latencyLe2500: 0,
    };
}

export interface MetricsWindow {
    start: Date;
    end: Date;
}

const MAX_WINDOW_HOURS = 31 * 24;

const NAMED_WINDOW_HOURS: Record<string, number> = {
    "1h": 1,
    "24h": 24,
    "7d": 7 * 24,
    "30d": 30 * 24,
};

/**
 * Resolve a metrics query window. Accepts a named `window` (`1h`, `24h`, `7d`,
 * `30d`) or explicit `from`/`to` ISO timestamps; defaults to the last 24h and
 * clamps the span to 31 days. Always returns a half-open `[start, end)` range.
 */
export function resolveMetricsWindow(
    query: { window?: string; from?: string; to?: string },
    now: Date = new Date(),
): MetricsWindow {
    const end = query.to ? new Date(query.to) : now;
    const validEnd = Number.isNaN(end.getTime()) ? now : end;

    let start: Date;
    if (query.from) {
        const parsed = new Date(query.from);
        start = Number.isNaN(parsed.getTime())
            ? new Date(validEnd.getTime() - 24 * 3600_000)
            : parsed;
    } else {
        const named =
            NAMED_WINDOW_HOURS[(query.window ?? "").toLowerCase()] ?? 24;
        start = new Date(validEnd.getTime() - named * 3600_000);
    }

    if (start >= validEnd) {
        start = new Date(validEnd.getTime() - 24 * 3600_000);
    }
    const maxSpanMs = MAX_WINDOW_HOURS * 3600_000;
    if (validEnd.getTime() - start.getTime() > maxSpanMs) {
        start = new Date(validEnd.getTime() - maxSpanMs);
    }

    return { start, end: validEnd };
}
