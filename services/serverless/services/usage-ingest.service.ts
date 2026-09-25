import { eq, sql } from 'drizzle-orm'
import { db } from '../infrastructure/db/db.js'
import {
    bandwidthUsageHourly,
    pages,
    serviceMetricsHourly,
    siteDailyStats,
    usageIngestDedup,
} from '../infrastructure/db/schema.js'

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

/**
 * Internal usage-ingest service.
 *
 * Vector aggregates Caddy access-log records per site per hour-bucket and POSTs
 * them to `/internal/usage/ingest`. This service applies each record atomically:
 *
 *  1. Claim idempotency via `usage_ingest_dedup` (deterministic `ingest_id`).
 *     A record whose `ingest_id` was already applied is skipped, so a retried
 *     batch or a Vector replay can never double-count.
 *  2. Additive UPSERT into `bandwidth_usage_hourly` (billing resource).
 *  3. Additive UPSERT into `service_metrics_hourly` (operational metrics).
 *  4. Additive UPSERT into `site_daily_stats` (legacy console rollup).
 *
 * Aggregation happens in Vector; the API only applies the pre-aggregated hourly
 * totals, so we never store one row per request.
 */

interface IngestRecord {
    ingest_id: string
    site_id: string
    /** ISO timestamp truncated to the hour (e.g. "2026-09-24T14:00:00.000Z"). */
    bucket: string
    bandwidth_bytes?: number
    requests?: number
    status_2xx?: number
    status_3xx?: number
    status_4xx?: number
    status_5xx?: number
    cache_hits?: number
    cache_misses?: number
    latency_sum_ms?: number
    latency_le_50?: number
    latency_le_100?: number
    latency_le_250?: number
    latency_le_500?: number
    latency_le_1000?: number
    latency_le_2500?: number
}

export interface IngestResult {
    applied: number
    skipped: number
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function toNumber(v: unknown): number {
    const n = Number(v)
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0
}

function toDate(v: unknown): Date | null {
    if (typeof v !== 'string' || !v) return null
    const t = Date.parse(v)
    if (!Number.isFinite(t)) return null
    return new Date(t)
}

/** Naive UTC date string (YYYY-MM-DD) for the site_daily_stats rollup. */
function utcDateKey(date: Date): string {
    return date.toISOString().slice(0, 10)
}

async function resolveTenantId(siteId: string, tx: Tx): Promise<string | null> {
    const [page] = await tx
        .select({ tenantId: pages.tenant_id })
        .from(pages)
        .where(eq(pages.site_id, siteId))
        .limit(1)
    return page?.tenantId ?? null
}

/**
 * Apply a single validated record inside an already-open transaction. Returns
 * true if it was newly applied, false if it was a duplicate (already claimed).
 */
async function applyRecord(
    tx: Tx,
    rec: IngestRecord
): Promise<boolean> {
    // 1. Claim idempotency. INSERT ... ON CONFLICT DO NOTHING avoids aborting
    //    the transaction on a duplicate (a caught unique-violation would leave
    //    the transaction in a failed state). rowCount 0 => already applied.
    const claimed = await tx
        .insert(usageIngestDedup)
        .values({ ingestId: rec.ingest_id })
        .onConflictDoNothing()
        .returning({ ingestId: usageIngestDedup.ingestId })
    if (claimed.length === 0) return false

    const bucket = toDate(rec.bucket)
    if (!bucket) return false

    // 2. Resolve tenant for the billing table (bandwidth_usage_hourly PK).
    const tenantId = await resolveTenantId(rec.site_id, tx)
    const bandwidth = toNumber(rec.bandwidth_bytes)

    if (tenantId && bandwidth > 0) {
        await tx
            .insert(bandwidthUsageHourly)
            .values({ tenantId, siteId: rec.site_id, bucket, bytes: bandwidth })
            .onConflictDoUpdate({
                target: [bandwidthUsageHourly.tenantId, bandwidthUsageHourly.siteId, bandwidthUsageHourly.bucket],
                set: {
                    bytes: sql`${bandwidthUsageHourly.bytes} + ${bandwidth}`,
                    updatedAt: sql`now()`,
                },
            })
    }

    // 3. Operational metrics (always recorded, even with zero bandwidth).
    await tx
        .insert(serviceMetricsHourly)
        .values({
            siteId: rec.site_id,
            bucket,
            requests: toNumber(rec.requests),
            status2xx: toNumber(rec.status_2xx),
            status3xx: toNumber(rec.status_3xx),
            status4xx: toNumber(rec.status_4xx),
            status5xx: toNumber(rec.status_5xx),
            bytes: bandwidth,
            cacheHits: toNumber(rec.cache_hits),
            cacheMisses: toNumber(rec.cache_misses),
            latencySumMs: toNumber(rec.latency_sum_ms),
            latencyLe50: toNumber(rec.latency_le_50),
            latencyLe100: toNumber(rec.latency_le_100),
            latencyLe250: toNumber(rec.latency_le_250),
            latencyLe500: toNumber(rec.latency_le_500),
            latencyLe1000: toNumber(rec.latency_le_1000),
            latencyLe2500: toNumber(rec.latency_le_2500),
        })
        .onConflictDoUpdate({
            target: [serviceMetricsHourly.siteId, serviceMetricsHourly.bucket],
            set: {
                requests: sql`${serviceMetricsHourly.requests} + ${toNumber(rec.requests)}`,
                status2xx: sql`${serviceMetricsHourly.status2xx} + ${toNumber(rec.status_2xx)}`,
                status3xx: sql`${serviceMetricsHourly.status3xx} + ${toNumber(rec.status_3xx)}`,
                status4xx: sql`${serviceMetricsHourly.status4xx} + ${toNumber(rec.status_4xx)}`,
                status5xx: sql`${serviceMetricsHourly.status5xx} + ${toNumber(rec.status_5xx)}`,
                bytes: sql`${serviceMetricsHourly.bytes} + ${bandwidth}`,
                cacheHits: sql`${serviceMetricsHourly.cacheHits} + ${toNumber(rec.cache_hits)}`,
                cacheMisses: sql`${serviceMetricsHourly.cacheMisses} + ${toNumber(rec.cache_misses)}`,
                latencySumMs: sql`${serviceMetricsHourly.latencySumMs} + ${toNumber(rec.latency_sum_ms)}`,
                latencyLe50: sql`${serviceMetricsHourly.latencyLe50} + ${toNumber(rec.latency_le_50)}`,
                latencyLe100: sql`${serviceMetricsHourly.latencyLe100} + ${toNumber(rec.latency_le_100)}`,
                latencyLe250: sql`${serviceMetricsHourly.latencyLe250} + ${toNumber(rec.latency_le_250)}`,
                latencyLe500: sql`${serviceMetricsHourly.latencyLe500} + ${toNumber(rec.latency_le_500)}`,
                latencyLe1000: sql`${serviceMetricsHourly.latencyLe1000} + ${toNumber(rec.latency_le_1000)}`,
                latencyLe2500: sql`${serviceMetricsHourly.latencyLe2500} + ${toNumber(rec.latency_le_2500)}`,
                updatedAt: sql`now()`,
            },
        })

    // 4. Legacy daily rollup (consumed by getPageUsage in page.service.ts).
    const dailyRequests = toNumber(rec.requests)
    const date = utcDateKey(bucket)
    await tx
        .insert(siteDailyStats)
        .values({
            siteId: rec.site_id,
            date,
            requests: dailyRequests,
            bandwidth,
            requests2xx: toNumber(rec.status_2xx),
            requests3xx: toNumber(rec.status_3xx),
            requests4xx: toNumber(rec.status_4xx),
            requests5xx: toNumber(rec.status_5xx),
        })
        .onConflictDoUpdate({
            target: [siteDailyStats.siteId, siteDailyStats.date],
            set: {
                requests: sql`${siteDailyStats.requests} + ${dailyRequests}`,
                bandwidth: sql`${siteDailyStats.bandwidth} + ${bandwidth}`,
                requests2xx: sql`${siteDailyStats.requests2xx} + ${toNumber(rec.status_2xx)}`,
                requests3xx: sql`${siteDailyStats.requests3xx} + ${toNumber(rec.status_3xx)}`,
                requests4xx: sql`${siteDailyStats.requests4xx} + ${toNumber(rec.status_4xx)}`,
                requests5xx: sql`${siteDailyStats.requests5xx} + ${toNumber(rec.status_5xx)}`,
                updatedAt: sql`now()`,
            },
        })

    return true
}

function validateRecord(raw: unknown): IngestRecord | null {
    if (typeof raw !== 'object' || raw === null) return null
    const r = raw as Record<string, unknown>
    const ingestId = typeof r['ingest_id'] === 'string' ? r['ingest_id'] : ''
    const siteId = typeof r['site_id'] === 'string' ? r['site_id'] : ''
    const bucket = typeof r['bucket'] === 'string' ? r['bucket'] : ''
    if (!ingestId || !siteId || !UUID_RE.test(siteId) || !bucket) return null
    return {
        ingest_id: ingestId,
        site_id: siteId,
        bucket,
        bandwidth_bytes: toNumber(r['bandwidth_bytes']),
        requests: toNumber(r['requests']),
        status_2xx: toNumber(r['status_2xx']),
        status_3xx: toNumber(r['status_3xx']),
        status_4xx: toNumber(r['status_4xx']),
        status_5xx: toNumber(r['status_5xx']),
        cache_hits: toNumber(r['cache_hits']),
        cache_misses: toNumber(r['cache_misses']),
        latency_sum_ms: toNumber(r['latency_sum_ms']),
        latency_le_50: toNumber(r['latency_le_50']),
        latency_le_100: toNumber(r['latency_le_100']),
        latency_le_250: toNumber(r['latency_le_250']),
        latency_le_500: toNumber(r['latency_le_500']),
        latency_le_1000: toNumber(r['latency_le_1000']),
        latency_le_2500: toNumber(r['latency_le_2500']),
    }
}

/** Parse a body that is a JSON array, a single JSON object, or newline-delimited JSON objects. */
export function parseIngestBody(body: unknown): unknown[] {
    if (Array.isArray(body)) return body
    if (body !== null && typeof body === 'object') return [body]
    if (typeof body === 'string' && body.trim().length > 0) {
        const out: unknown[] = []
        for (const line of body.split('\n')) {
            const trimmed = line.trim()
            if (!trimmed) continue
            try {
                out.push(JSON.parse(trimmed))
            } catch {
                // skip malformed NDJSON line
            }
        }
        return out
    }
    return []
}

/**
 * Apply a batch of aggregated records in a single transaction. Every record
 * that parses and validates is applied (or skipped as a duplicate). Returns the
 * number newly applied vs skipped.
 */
export async function ingestUsage(records: unknown[]): Promise<IngestResult> {
    const valid = records
        .map(validateRecord)
        .filter((r): r is IngestRecord => r !== null)

    if (valid.length === 0) return { applied: 0, skipped: 0 }

    let applied = 0
    let skipped = 0

    // Duplicate ingest_id within the same batch: only apply once.
    const seen = new Set<string>()

    await db.transaction(async (tx) => {
        for (const rec of valid) {
            if (seen.has(rec.ingest_id)) {
                skipped++
                continue
            }
            seen.add(rec.ingest_id)
            if (await applyRecord(tx, rec)) applied++
            else skipped++
        }
    })

    return { applied, skipped }
}
