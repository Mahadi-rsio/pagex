import { eq, sql } from "drizzle-orm";
import { getPlan, type PlanId } from "@/server/api/constants/pricing";
import { db } from "@/server/api/infrastructure/db/db";
import { pages } from "@/server/api/infrastructure/db/schema";
import {
    buildMetricsResponse,
    emptyMetricsInput,
    type MetricsInput,
    type MetricsResponse,
    type MetricsWindow,
} from "@/server/api/utils/metrics";
import { withLivePage } from "@/server/api/utils/page-visibility";
import {
    buildUsageResponse,
    currentUsageWindow,
    type UsageResponse,
    type UsageWindow,
} from "@/server/api/utils/usage";

/**
 * Usage / metrics read model.
 *
 * Bandwidth and metrics come from `usage_hourly`, written by the service/logs
 * pipeline (Cloudflare Logpush http_requests → R2 → one-shot Fly worker,
 * aggregated per host per UTC hour). Counts are keyed by request host, so every
 * lookup resolves the tenant page's `domain` first. A site or project that does
 * not belong to the caller is treated as not found.
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
        .where(
            withLivePage(
                eq(pages.site_id, siteId),
                eq(pages.tenant_id, tenantId),
            ),
        )
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
        .where(
            withLivePage(eq(pages.id, pageId), eq(pages.tenant_id, tenantId)),
        )
        .limit(1);
    return page ?? null;
}

async function listTenantPages(tenantId: string): Promise<TenantPage[]> {
    return db
        .select(pageSelection)
        .from(pages)
        .where(withLivePage(eq(pages.tenant_id, tenantId)));
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
    domains: string[],
    window: UsageWindow,
): Promise<number> {
    if (domains.length === 0) return 0;
    const result = (await db.execute(sql`
        SELECT coalesce(sum("bytes"), 0)::bigint AS bytes
        FROM usage_hourly
        WHERE host IN (${sql.join(
            domains.map((d) => sql`${d}`),
            sql`, `,
        )})
          AND hour >= ${window.start}
          AND hour < ${window.end}
    `)) as unknown as { rows: Array<{ bytes: string }> };
    return Number(result.rows[0]?.bytes ?? 0);
}

export async function getSiteUsage(
    siteId: string,
    tenantId: string,
    now: Date = new Date(),
): Promise<UsageResponse | null> {
    const page = await findPageBySite(siteId, tenantId);
    if (!page) return null;

    const window = currentUsageWindow(now);
    const dbBytes = await sumBandwidthFromDb([page.domain], window);
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
    const dbBytes = await sumBandwidthFromDb([page.domain], window);
    return buildUsageResponse(page.plan, dbBytes, window);
}

export async function getAccountUsage(
    tenantId: string,
    now: Date = new Date(),
): Promise<UsageResponse> {
    const tenantPages = await listTenantPages(tenantId);
    const window = currentUsageWindow(now);
    const domains = tenantPages.map((p) => p.domain);
    const plan = highestPlan(tenantPages.map((p) => p.plan));

    const dbBytes = await sumBandwidthFromDb(domains, window);
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
    const domains = tenantPages.map((p) => p.domain);
    const plan = highestPlan(tenantPages.map((p) => p.plan));

    const dbBytes = await sumBandwidthFromDb(domains, window);
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

    const result = (await db.execute(sql`
        SELECT
            coalesce(sum("requests"), 0)::bigint AS requests,
            coalesce(sum("s2xx"), 0)::bigint AS s2xx,
            coalesce(sum("s3xx"), 0)::bigint AS s3xx,
            coalesce(sum("s4xx"), 0)::bigint AS s4xx,
            coalesce(sum("s5xx"), 0)::bigint AS s5xx,
            coalesce(sum("bytes"), 0)::bigint AS bytes,
            coalesce(sum("cache_hits"), 0)::bigint AS cache_hits
        FROM usage_hourly
        WHERE host = ${page.domain}
          AND hour >= ${window.start}
          AND hour < ${window.end}
    `)) as unknown as {
        rows: Array<{
            requests: string;
            s2xx: string;
            s3xx: string;
            s4xx: string;
            s5xx: string;
            bytes: string;
            cache_hits: string;
        }>;
    };

    const row = result.rows[0];
    const input: MetricsInput = row
        ? {
              requests: Number(row.requests),
              status2xx: Number(row.s2xx),
              status3xx: Number(row.s3xx),
              status4xx: Number(row.s4xx),
              status5xx: Number(row.s5xx),
              bytes: Number(row.bytes),
              cacheHits: Number(row.cache_hits),
              cacheMisses: 0,
              latencySumMs: 0,
              latencyLe50: 0,
              latencyLe100: 0,
              latencyLe250: 0,
              latencyLe500: 0,
              latencyLe1000: 0,
              latencyLe2500: 0,
          }
        : emptyMetricsInput();
    return buildMetricsResponse(input);
}
