import { and, eq, gte, inArray, lt, sql } from 'drizzle-orm'
import { db } from '../infrastructure/db/db.js'
import { bandwidthUsageHourly, pages, serviceMetricsHourly } from '../infrastructure/db/schema.js'
import { redis } from '../infrastructure/cache/redis.js'
import { getPlan, type PlanId } from '../constants/pricing.js'
import { buildUsageResponse, currentUsageWindow, type UsageResponse, type UsageWindow } from '../utils/usage.js'
import {
    buildMetricsResponse,
    emptyMetricsInput,
    type MetricsInput,
    type MetricsResponse,
    type MetricsWindow,
} from '../utils/metrics.js'

/**
 * Usage / metrics read model.
 *
 * Usage (bandwidth, billing/quota) comes from `bandwidth_usage_hourly` plus the
 * unflushed live counters in Redis DB0. Metrics (requests/status/latency/cache)
 * come from `service_metrics_hourly`. Every lookup is tenant-scoped: a site or
 * project that does not belong to the caller is treated as not found.
 */

const PLAN_RANK: Record<PlanId, number> = { free: 0, paid: 1 }
const HOUR_MS = 3600_000

interface TenantPage {
    id: string
    siteId: string
    plan: string
    projectName: string
    domain: string
}

const pageSelection = {
    id: pages.id,
    siteId: pages.site_id,
    plan: pages.plan,
    projectName: pages.project_name,
    domain: pages.domain,
}

async function findPageBySite(siteId: string, tenantId: string): Promise<TenantPage | null> {
    const [page] = await db
        .select(pageSelection)
        .from(pages)
        .where(and(eq(pages.site_id, siteId), eq(pages.tenant_id, tenantId)))
        .limit(1)
    return page ?? null
}

async function findPageById(pageId: string, tenantId: string): Promise<TenantPage | null> {
    const [page] = await db
        .select(pageSelection)
        .from(pages)
        .where(and(eq(pages.id, pageId), eq(pages.tenant_id, tenantId)))
        .limit(1)
    return page ?? null
}

async function listTenantPages(tenantId: string): Promise<TenantPage[]> {
    return db.select(pageSelection).from(pages).where(eq(pages.tenant_id, tenantId))
}

/** Account plan is the strongest plan across the tenant's sites. */
function highestPlan(plans: string[]): PlanId {
    let best: PlanId = 'free'
    for (const plan of plans) {
        const id = getPlan(plan).id
        if (PLAN_RANK[id] > PLAN_RANK[best]) best = id
    }
    return best
}

function formatHourBucket(date: Date): string {
    return date.toISOString().slice(0, 13).replace(/[-T:]/g, '')
}

/**
 * Sum unflushed bandwidth counters from Redis for the window. Bounded to the
 * last 48h (the Redis bucket TTL); flushed buckets are deleted from Redis, so
 * this never double-counts with the DB aggregate.
 */
async function readLiveBandwidth(siteIds: string[], window: UsageWindow, now: Date): Promise<number> {
    if (siteIds.length === 0) return 0

    const liveFromMs = Math.max(window.start.getTime(), now.getTime() - 48 * HOUR_MS)
    const fromHour = new Date(Math.floor(liveFromMs / HOUR_MS) * HOUR_MS)
    const toHour = new Date(Math.floor(now.getTime() / HOUR_MS) * HOUR_MS)

    const keys: string[] = []
    for (const siteId of siteIds) {
        for (let t = fromHour.getTime(); t <= toHour.getTime(); t += HOUR_MS) {
            keys.push(`usage:bw:${siteId}:${formatHourBucket(new Date(t))}`)
        }
    }
    if (keys.length === 0) return 0

    let total = 0
    try {
        const CHUNK = 1000
        for (let i = 0; i < keys.length; i += CHUNK) {
            const values = await redis.mget(keys.slice(i, i + CHUNK))
            for (const value of values) {
                const n = Number(value)
                if (Number.isFinite(n) && n > 0) total += n
            }
        }
    } catch (err) {
        // Redis is a read-through accelerator here; the flushed DB totals remain
        // authoritative, so degrade gracefully instead of failing the request.
        console.error('[usage] live bandwidth read failed:', (err as Error).message)
    }
    return total
}

async function sumBandwidthFromDb(siteIds: string[], tenantId: string, window: UsageWindow): Promise<number> {
    if (siteIds.length === 0) return 0
    const [row] = await db
        .select({
            bytes: sql<number>`coalesce(sum(${bandwidthUsageHourly.bytes}), 0)::bigint`.mapWith(Number),
        })
        .from(bandwidthUsageHourly)
        .where(
            and(
                eq(bandwidthUsageHourly.tenantId, tenantId),
                inArray(bandwidthUsageHourly.siteId, siteIds),
                gte(bandwidthUsageHourly.bucket, window.start),
                lt(bandwidthUsageHourly.bucket, window.end)
            )
        )
    return row?.bytes ?? 0
}

export async function getSiteUsage(
    siteId: string,
    tenantId: string,
    now: Date = new Date()
): Promise<UsageResponse | null> {
    const page = await findPageBySite(siteId, tenantId)
    if (!page) return null

    const window = currentUsageWindow(now)
    const [dbBytes, liveBytes] = await Promise.all([
        sumBandwidthFromDb([page.siteId], tenantId, window),
        readLiveBandwidth([page.siteId], window, now),
    ])
    return buildUsageResponse(page.plan, dbBytes + liveBytes, window)
}

export async function getProjectUsage(
    projectId: string,
    tenantId: string,
    now: Date = new Date()
): Promise<UsageResponse | null> {
    const page = await findPageById(projectId, tenantId)
    if (!page) return null

    const window = currentUsageWindow(now)
    const [dbBytes, liveBytes] = await Promise.all([
        sumBandwidthFromDb([page.siteId], tenantId, window),
        readLiveBandwidth([page.siteId], window, now),
    ])
    return buildUsageResponse(page.plan, dbBytes + liveBytes, window)
}

export async function getAccountUsage(tenantId: string, now: Date = new Date()): Promise<UsageResponse> {
    const tenantPages = await listTenantPages(tenantId)
    const window = currentUsageWindow(now)
    const siteIds = tenantPages.map((p) => p.siteId)
    const plan = highestPlan(tenantPages.map((p) => p.plan))

    const [dbBytes, liveBytes] = await Promise.all([
        sumBandwidthFromDb(siteIds, tenantId, window),
        readLiveBandwidth(siteIds, window, now),
    ])
    return buildUsageResponse(plan, dbBytes + liveBytes, window)
}

export interface AccountQuota {
    plan: PlanId
    planName: string
    period: { start: string; end: string; key: string }
    siteCount: number
    bandwidth: UsageResponse['bandwidth']
}

export async function getAccountQuota(tenantId: string, now: Date = new Date()): Promise<AccountQuota> {
    const tenantPages = await listTenantPages(tenantId)
    const window = currentUsageWindow(now)
    const siteIds = tenantPages.map((p) => p.siteId)
    const plan = highestPlan(tenantPages.map((p) => p.plan))

    const [dbBytes, liveBytes] = await Promise.all([
        sumBandwidthFromDb(siteIds, tenantId, window),
        readLiveBandwidth(siteIds, window, now),
    ])
    const usage = buildUsageResponse(plan, dbBytes + liveBytes, window)
    return {
        plan: usage.plan,
        planName: usage.planName,
        period: usage.period,
        siteCount: tenantPages.length,
        bandwidth: usage.bandwidth,
    }
}

export async function getSiteMetrics(
    siteId: string,
    tenantId: string,
    window: MetricsWindow
): Promise<MetricsResponse | null> {
    const page = await findPageBySite(siteId, tenantId)
    if (!page) return null

    const [row] = await db
        .select({
            requests: sql<number>`coalesce(sum(${serviceMetricsHourly.requests}), 0)::bigint`.mapWith(Number),
            status2xx: sql<number>`coalesce(sum(${serviceMetricsHourly.status2xx}), 0)::bigint`.mapWith(Number),
            status3xx: sql<number>`coalesce(sum(${serviceMetricsHourly.status3xx}), 0)::bigint`.mapWith(Number),
            status4xx: sql<number>`coalesce(sum(${serviceMetricsHourly.status4xx}), 0)::bigint`.mapWith(Number),
            status5xx: sql<number>`coalesce(sum(${serviceMetricsHourly.status5xx}), 0)::bigint`.mapWith(Number),
            bytes: sql<number>`coalesce(sum(${serviceMetricsHourly.bytes}), 0)::bigint`.mapWith(Number),
            cacheHits: sql<number>`coalesce(sum(${serviceMetricsHourly.cacheHits}), 0)::bigint`.mapWith(Number),
            cacheMisses: sql<number>`coalesce(sum(${serviceMetricsHourly.cacheMisses}), 0)::bigint`.mapWith(Number),
            latencySumMs: sql<number>`coalesce(sum(${serviceMetricsHourly.latencySumMs}), 0)::bigint`.mapWith(Number),
            latencyLe50: sql<number>`coalesce(sum(${serviceMetricsHourly.latencyLe50}), 0)::bigint`.mapWith(Number),
            latencyLe100: sql<number>`coalesce(sum(${serviceMetricsHourly.latencyLe100}), 0)::bigint`.mapWith(Number),
            latencyLe250: sql<number>`coalesce(sum(${serviceMetricsHourly.latencyLe250}), 0)::bigint`.mapWith(Number),
            latencyLe500: sql<number>`coalesce(sum(${serviceMetricsHourly.latencyLe500}), 0)::bigint`.mapWith(Number),
            latencyLe1000: sql<number>`coalesce(sum(${serviceMetricsHourly.latencyLe1000}), 0)::bigint`.mapWith(Number),
            latencyLe2500: sql<number>`coalesce(sum(${serviceMetricsHourly.latencyLe2500}), 0)::bigint`.mapWith(Number),
        })
        .from(serviceMetricsHourly)
        .where(
            and(
                eq(serviceMetricsHourly.siteId, page.siteId),
                gte(serviceMetricsHourly.bucket, window.start),
                lt(serviceMetricsHourly.bucket, window.end)
            )
        )

    const input: MetricsInput = row ?? emptyMetricsInput()
    return buildMetricsResponse(input)
}
