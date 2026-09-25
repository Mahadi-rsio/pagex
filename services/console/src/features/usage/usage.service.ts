import { and, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { db } from "@/server/api/infrastructure/db/db";
import {
    bandwidthUsageHourly,
    pages,
    serviceMetricsHourly,
} from "@/server/api/infrastructure/db/schema";
import { getPlan, type PlanId } from "@/server/api/constants/pricing";
import {
    buildUsageResponse,
    currentUsageWindow,
    type UsageResponse,
    type UsageWindow,
} from "@/server/api/utils/usage";
import {
    buildMetricsResponse,
    emptyMetricsInput,
    type MetricsInput,
    type MetricsResponse,
    type MetricsWindow,
} from "@/server/api/utils/metrics";

/**
 * Usage / metrics read model.
 *
 * Usage (bandwidth, billing/quota) comes from `bandwidth_usage_hourly`.
 * Metrics (requests/status/latency/cache) come from `service_metrics_hourly`.
 * Both are written by the internal ingest endpoint (fed by Vector from Caddy
 * access logs). Every lookup is tenant-scoped: a site or project that does not
 * belong to the caller is treated as not found.
 */

const PLAN_RANK: Record<PlanId, number> = { free: 0, paid: 1 };

interface TenantPage {
    id: string;
    siteId: string;
    plan: string;
    projectName: string;
    domain: string;
}

const pageSelection = {
    id: pages.id,
    siteId: pages.site_id,
    plan: pages.plan,
    projectName: pages.project_name,
    domain: pages.domain,
};

async function findPageBySite(
    siteId: string,
    tenantId: string,
): Promise<TenantPage | null> {
    const [page] = await db
        .select(pageSelection)
        .from(pages)
        .where(and(eq(pages.site_id, siteId), eq(pages.tenant_id, tenantId)))
        .limit(1);
    return page ?? null;
}

async function findPageById(
    pageId: string,
    tenantId: string,
): Promise<TenantPage | null> {
    const [page] = await db
        .select(pageSelection)
        .from(pages)
        .where(and(eq(pages.id, pageId), eq(pages.tenant_id, tenantId)))
        .limit(1);
    return page ?? null;
}

async function listTenantPages(tenantId: string): Promise<TenantPage[]> {
    return db
        .select(pageSelection)
        .from(pages)
        .where(eq(pages.tenant_id, tenantId));
}

/** Account plan is the strongest plan across the tenant's sites. */
function highestPlan(plans: string[]): PlanId {
    let best: PlanId = "free";
    for (const plan of plans) {
        const id = getPlan(plan).id;
        if (PLAN_RANK[id] > PLAN_RANK[best]) best = id;
    }
    return best;
}

async function sumBandwidthFromDb(
    siteIds: string[],
    tenantId: string,
    window: UsageWindow,
): Promise<number> {
    if (siteIds.length === 0) return 0;
    const [row] = await db
        .select({
            bytes: sql<number>`coalesce(sum(${bandwidthUsageHourly.bytes}), 0)::bigint`.mapWith(
                Number,
            ),
        })
        .from(bandwidthUsageHourly)
        .where(
            and(
                eq(bandwidthUsageHourly.tenantId, tenantId),
                inArray(bandwidthUsageHourly.siteId, siteIds),
                gte(bandwidthUsageHourly.bucket, window.start),
                lt(bandwidthUsageHourly.bucket, window.end),
            ),
        );
    return row?.bytes ?? 0;
}

export async function getSiteUsage(
    siteId: string,
    tenantId: string,
    now: Date = new Date(),
): Promise<UsageResponse | null> {
    const page = await findPageBySite(siteId, tenantId);
    if (!page) return null;

    const window = currentUsageWindow(now);
    const dbBytes = await sumBandwidthFromDb([page.siteId], tenantId, window);
    return buildUsageResponse(page.plan, dbBytes, window);
}

export async function getProjectUsage(
    projectId: string,
    tenantId: string,
    now: Date = new Date(),
): Promise<UsageResponse | null> {
    const page = await findPageById(projectId, tenantId);
    if (!page) return null;

    const window = currentUsageWindow(now);
    const dbBytes = await sumBandwidthFromDb([page.siteId], tenantId, window);
    return buildUsageResponse(page.plan, dbBytes, window);
}

export async function getAccountUsage(
    tenantId: string,
    now: Date = new Date(),
): Promise<UsageResponse> {
    const tenantPages = await listTenantPages(tenantId);
    const window = currentUsageWindow(now);
    const siteIds = tenantPages.map((p) => p.siteId);
    const plan = highestPlan(tenantPages.map((p) => p.plan));

    const dbBytes = await sumBandwidthFromDb(siteIds, tenantId, window);
    return buildUsageResponse(plan, dbBytes, window);
}

export interface AccountQuota {
    plan: PlanId;
    planName: string;
    period: { start: string; end: string; key: string };
    siteCount: number;
    bandwidth: UsageResponse["bandwidth"];
}

export async function getAccountQuota(
    tenantId: string,
    now: Date = new Date(),
): Promise<AccountQuota> {
    const tenantPages = await listTenantPages(tenantId);
    const window = currentUsageWindow(now);
    const siteIds = tenantPages.map((p) => p.siteId);
    const plan = highestPlan(tenantPages.map((p) => p.plan));

    const dbBytes = await sumBandwidthFromDb(siteIds, tenantId, window);
    const usage = buildUsageResponse(plan, dbBytes, window);
    return {
        plan: usage.plan,
        planName: usage.planName,
        period: usage.period,
        siteCount: tenantPages.length,
        bandwidth: usage.bandwidth,
    };
}

export async function getSiteMetrics(
    siteId: string,
    tenantId: string,
    window: MetricsWindow,
): Promise<MetricsResponse | null> {
    const page = await findPageBySite(siteId, tenantId);
    if (!page) return null;

    const [row] = await db
        .select({
            requests:
                sql<number>`coalesce(sum(${serviceMetricsHourly.requests}), 0)::bigint`.mapWith(
                    Number,
                ),
            status2xx:
                sql<number>`coalesce(sum(${serviceMetricsHourly.status2xx}), 0)::bigint`.mapWith(
                    Number,
                ),
            status3xx:
                sql<number>`coalesce(sum(${serviceMetricsHourly.status3xx}), 0)::bigint`.mapWith(
                    Number,
                ),
            status4xx:
                sql<number>`coalesce(sum(${serviceMetricsHourly.status4xx}), 0)::bigint`.mapWith(
                    Number,
                ),
            status5xx:
                sql<number>`coalesce(sum(${serviceMetricsHourly.status5xx}), 0)::bigint`.mapWith(
                    Number,
                ),
            bytes: sql<number>`coalesce(sum(${serviceMetricsHourly.bytes}), 0)::bigint`.mapWith(
                Number,
            ),
            cacheHits:
                sql<number>`coalesce(sum(${serviceMetricsHourly.cacheHits}), 0)::bigint`.mapWith(
                    Number,
                ),
            cacheMisses:
                sql<number>`coalesce(sum(${serviceMetricsHourly.cacheMisses}), 0)::bigint`.mapWith(
                    Number,
                ),
            latencySumMs:
                sql<number>`coalesce(sum(${serviceMetricsHourly.latencySumMs}), 0)::bigint`.mapWith(
                    Number,
                ),
            latencyLe50:
                sql<number>`coalesce(sum(${serviceMetricsHourly.latencyLe50}), 0)::bigint`.mapWith(
                    Number,
                ),
            latencyLe100:
                sql<number>`coalesce(sum(${serviceMetricsHourly.latencyLe100}), 0)::bigint`.mapWith(
                    Number,
                ),
            latencyLe250:
                sql<number>`coalesce(sum(${serviceMetricsHourly.latencyLe250}), 0)::bigint`.mapWith(
                    Number,
                ),
            latencyLe500:
                sql<number>`coalesce(sum(${serviceMetricsHourly.latencyLe500}), 0)::bigint`.mapWith(
                    Number,
                ),
            latencyLe1000:
                sql<number>`coalesce(sum(${serviceMetricsHourly.latencyLe1000}), 0)::bigint`.mapWith(
                    Number,
                ),
            latencyLe2500:
                sql<number>`coalesce(sum(${serviceMetricsHourly.latencyLe2500}), 0)::bigint`.mapWith(
                    Number,
                ),
        })
        .from(serviceMetricsHourly)
        .where(
            and(
                eq(serviceMetricsHourly.siteId, page.siteId),
                gte(serviceMetricsHourly.bucket, window.start),
                lt(serviceMetricsHourly.bucket, window.end),
            ),
        );

    const input: MetricsInput = row ?? emptyMetricsInput();
    return buildMetricsResponse(input);
}
