import { and, eq, sql } from "drizzle-orm";
import { customAlphabet } from "nanoid";
import { enqueuePageDelete } from "@/features/background/jobs";
import { clearSiteFilesMap } from "@/features/deployments/deploy.service";
import { pageDeploymentLock } from "@/features/deployments/deployment-lock.service";
import { clearDeploymentRuntimeCache } from "@/features/deployments/manifest.service";
import {
    DEPLOY_LOCK_PREPARE_TTL_SECONDS,
    TOP_LEVEL_DOMAIN,
} from "@/server/api/constants/index";
import { redis, redisKey } from "@/server/api/infrastructure/cache/redis";
import { routingWriter } from "@/server/api/infrastructure/cache/routing";
import { db } from "@/server/api/infrastructure/db/db";
import {
    blobs,
    blobTreeEntries,
    deployments,
    pages,
    sites,
} from "@/server/api/infrastructure/db/schema";
import { withLivePage } from "@/server/api/utils/page-visibility";
import type { CreatePageInput } from "./page.validator";

/**
 * Sentinel lock holder written by `deletePage`. It is intentionally unguessable
 * in the sense that no real deploy path can ever produce this exact string —
 * deploy holders are always `{prepare-token}`, `build:{buildId}`,
 * `commit:{uuid}` or `rollback:{deploymentId}` — so an in-flight deploy can
 * never release this fence, and `assertHeld` fails for it. The lock then lapses
 * with its TTL, by which point the `pages` row is long gone.
 */
const PAGE_DELETED_LOCK_HOLDER = "page:deleted:fence";

export async function createPage(
    data: CreatePageInput,
    reqHeader: { tenant_name: string; tenant_id: string },
) {
    const { project_name } = data;

    if (!reqHeader.tenant_id || !reqHeader.tenant_name) {
        return { message: "token is not valid" };
    }

    // Subdomain format: {project_name}-{random_number} — always unique, so
    // projects never squat a bare slug. Random suffix is digits-only.
    // Single-label (dash separator, not a dot) so tenant hosts stay one level
    // under the base domain and are covered by a `*.{base}` wildcard TLS cert
    // (Cloudflare Universal SSL / Let's Encrypt) without per-tenant certificates.
    const subdomainSuffix = customAlphabet("0123456789", 4);
    let subdomain = "";
    for (let attempt = 0; attempt < 5; attempt++) {
        const candidate = `${project_name.toLowerCase()}-${subdomainSuffix()}`;
        const existing = await db
            .select({ id: sites.id })
            .from(sites)
            .where(eq(sites.subdomain, candidate))
            .limit(1);
        if (existing.length === 0) {
            subdomain = candidate;
            break;
        }
    }
    if (!subdomain) {
        throw new Error("Could not generate a unique subdomain");
    }

    const domain = `${subdomain}.${TOP_LEVEL_DOMAIN}`;

    // 1. Insert into `sites` — this is what the caddy plugin reads.
    //    The returned UUID (site_id) is the MinIO key prefix.
    const [site] = await db
        .insert(sites)
        .values({
            subdomain,
            active: true,
        })
        .returning();

    if (!site) throw new Error("Failed to create site record");

    // 2. Insert tenant project metadata into `pages`
    const [page] = await db
        .insert(pages)
        .values({
            site_id: site.id,
            tenant_id: reqHeader.tenant_id,
            tenant_name: reqHeader.tenant_name,
            project_name,
            domain,
        })
        .returning();

    if (!page) throw new Error("Failed to create page record");

    // 3. Publish the immutable subdomain → site_id mapping to Redis. This is
    //    the blob-server's durable distributed lookup layer. Best-effort: the
    //    PostgreSQL rows above are authoritative, and the blob-server backfills
    //    Redis from Postgres on a miss.
    await routingWriter.setSubdomainMapping(subdomain, site.id);

    // 4. The caddy static_s3 plugin resolves subdomain → site_id → active
    //    deployment manifest → blobs/{sha256}. No per-tenant Caddy config or
    //    tenant/ prefix needed.

    console.log(`✅ Created project "${project_name}" → site_id: ${site.id}`);

    return {
        ...page,
        site_id: site.id,
    };
}

function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
    if (bytes < 1024 ** 3) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
    return `${(bytes / 1024 ** 3).toFixed(3)} GB`;
}

async function getActiveDeploymentStorage(pageId: string) {
    const [active] = await db
        .select({ id: deployments.id })
        .from(deployments)
        .where(
            and(
                eq(deployments.page_id, pageId),
                eq(deployments.is_active, true),
            ),
        )
        .limit(1);

    if (!active) {
        return { bytes: 0, fileCount: 0, human: "0 B" };
    }

    const [row] = await db
        .select({
            bytes: sql<number>`coalesce(sum(${blobs.size}), 0)::bigint`.mapWith(
                Number,
            ),
            fileCount: sql<number>`count(*)::int`.mapWith(Number),
        })
        .from(blobTreeEntries)
        .innerJoin(blobs, eq(blobTreeEntries.blobHash, blobs.hash))
        .where(eq(blobTreeEntries.deploymentId, active.id));

    const bytes = row?.bytes ?? 0;
    return {
        bytes,
        fileCount: row?.fileCount ?? 0,
        human: formatBytes(bytes),
    };
}

/**
 * Usage from the service/logs pipeline: Cloudflare Logpush http_requests →
 * R2 logs-raw → one-shot Fly worker aggregates hourly into
 * `usage_hourly` / `country_hourly` (keyed by request host). No live Redis
 * stats exist anymore; the pipeline refreshes every ~25 minutes.
 */
export async function getPageUsage(domain: string) {
    const [page] = await db
        .select({
            id: pages.id,
            site_id: pages.site_id,
            request_limit: pages.request_limit,
            bandwidth_limit: pages.bandwidth_limit,
        })
        .from(pages)
        .where(withLivePage(eq(pages.domain, domain)))
        .limit(1);

    if (!page) return null;

    const requestLimit = Number(page.request_limit) || 100_000;
    const bandwidthLimit = Number(page.bandwidth_limit) || 2147483648;

    interface UsageRow {
        requests: number;
        bytes: number;
        s2xx: number;
        s3xx: number;
        s4xx: number;
        s5xx: number;
        cacheHits: number;
    }

    const [aggRow] = (
        (await db.execute(sql`
            SELECT
                coalesce(sum("requests"), 0)::bigint AS requests,
                coalesce(sum("bytes"), 0)::bigint AS bytes,
                coalesce(sum("s2xx"), 0)::bigint AS s2xx,
                coalesce(sum("s3xx"), 0)::bigint AS s3xx,
                coalesce(sum("s4xx"), 0)::bigint AS s4xx,
                coalesce(sum("s5xx"), 0)::bigint AS s5xx,
                coalesce(sum("cache_hits"), 0)::bigint AS cache_hits
            FROM usage_hourly
            WHERE host = ${domain}
        `)) as unknown as { rows: UsageRow[] }
    ).rows;

    const [peakRow] = (
        (await db.execute(sql`
            SELECT hour, requests
            FROM usage_hourly
            WHERE host = ${domain}
            ORDER BY requests DESC
            LIMIT 1
        `)) as unknown as {
            rows: Array<{ hour: string; requests: string }>;
        }
    ).rows;

    // db.execute returns pg's text-format rows (no type parsers) — every
    // value is a string, so normalize numeric/date columns here.
    const agg = aggRow
        ? {
              requests: Number(aggRow.requests),
              bytes: Number(aggRow.bytes),
              s2xx: Number(aggRow.s2xx),
              s3xx: Number(aggRow.s3xx),
              s4xx: Number(aggRow.s4xx),
              s5xx: Number(aggRow.s5xx),
              cacheHits: Number(aggRow.cacheHits),
          }
        : {
              requests: 0,
              bytes: 0,
              s2xx: 0,
              s3xx: 0,
              s4xx: 0,
              s5xx: 0,
              cacheHits: 0,
          };

    const totalRequests = agg.requests;
    const totalBandwidth = agg.bytes;
    const storage = await getActiveDeploymentStorage(page.id);

    return {
        requests: {
            used: totalRequests,
            limit: requestLimit,
            flushed: totalRequests,
            live: 0,
        },
        bandwidth: {
            used_bytes: totalBandwidth,
            used_gb: (totalBandwidth / 1024 ** 3).toFixed(6),
            flushed_bytes: totalBandwidth,
            live_bytes: 0,
            limit_bytes: bandwidthLimit,
            limit: formatBytes(bandwidthLimit),
        },
        storage: {
            bytes: storage.bytes,
            human: storage.human,
            file_count: storage.fileCount,
        },
        sync: {
            pending_flush: false,
            interval_seconds: 1500,
        },
        traffic: {
            bots: 0,
            humans: 0,
            unique_ips: 0,
        },
        status_codes: {
            "2xx": agg.s2xx,
            "3xx": agg.s3xx,
            "4xx": agg.s4xx,
            "5xx": agg.s5xx,
        },
        peak: {
            hour: peakRow
                ? new Date(peakRow.hour).toISOString().slice(11, 13) + ":00"
                : null,
            requests: peakRow ? Number(peakRow.requests) : 0,
        },
    };
}

export async function getListPages(tenantId: string) {
    const result = await db
        .select()
        .from(pages)
        .where(withLivePage(eq(pages.tenant_id, tenantId)));
    return result;
}

export async function deletePage(pageId: string, tenantId: string) {
    const UUID_RE =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!UUID_RE.test(pageId)) return { error: "Page not found" };

    // Verify ownership
    const existing = await db
        .select()
        .from(pages)
        .where(withLivePage(eq(pages.id, pageId)))
        .limit(1);

    if (!existing.length) return { error: "Page not found" };
    if (existing[0]!.tenant_id !== tenantId) return { error: "Forbidden" };

    const page = existing[0]!;

    // 1. Make the project unusable before anything else, so a new deployment
    //    cannot go live behind the delete:
    //      - the soft delete removes it from every API read path
    //        (`withLivePage`), so prepare/presign/commit all 404.
    //      - `sites.active = false` makes the blob-server's routing lookups miss.
    //      - the deploy lock is taken under a sentinel holder that no deploy
    //        path can produce, so an already-in-flight commit fails its
    //        `assertHeld` check and refuses to activate.
    //
    //    The row itself survives because `deployments.page_id` is ON DELETE
    //    CASCADE: the background `page_delete` job needs those deployments to
    //    find the manifests and blob objects to remove.
    await db
        .update(pages)
        .set({ deletedAt: new Date() })
        .where(eq(pages.id, pageId));

    await db
        .update(sites)
        .set({ active: false })
        .where(eq(sites.id, page.site_id));

    await pageDeploymentLock
        .acquire(
            pageId,
            PAGE_DELETED_LOCK_HOLDER,
            DEPLOY_LOCK_PREPARE_TTL_SECONDS,
        )
        .catch((err) => {
            console.error(
                `[page-delete] could not fence deployments for page ${pageId}`,
                err,
            );
        });

    const [site] = await db
        .select({ subdomain: sites.subdomain })
        .from(sites)
        .where(eq(sites.id, page.site_id))
        .limit(1);

    // Stop routing traffic and drop the cached runtime state. Both are
    // best-effort: the PostgreSQL writes above have already committed and the
    // blob-server repairs a missing Redis key from Postgres on the next miss.
    await routingWriter.deleteSubdomainMapping(
        site?.subdomain ?? page.project_name,
    );
    await clearSiteFilesMap(page.site_id);
    await clearDeploymentRuntimeCache(page.site_id);

    try {
        await redis.del(redisKey(`site_version:${page.site_id}`));
        await redis.del(redisKey(`db_cache:${page.domain}`));
        await redis.del(redisKey(`requests:${page.domain}`));
        await redis.del(redisKey(`bandwidth:${page.domain}`));
    } catch (err) {
        console.error(
            `[routing] secondary cache cleanup failed for site ${page.site_id}; PostgreSQL remains authoritative`,
            err,
        );
    }

    // 2. Enqueue the asynchronous purge. The project is already invisible and
    //    unservable at this point, so a failed enqueue can only leak storage
    //    until a manual purge — it can never resurrect the project or put it
    //    back in front of traffic. The worker is idempotent, so a retried or
    //    duplicated delivery is safe.
    const enqueued = await enqueuePageDelete({
        pageId,
        siteId: page.site_id,
    });
    if (!enqueued) {
        console.error(
            `[page-delete] could not enqueue purge for page ${pageId} (site ${page.site_id}); ` +
                "deployments, MinIO objects and manifests are orphaned until a manual purge",
        );
    }

    console.log(
        `🗑️  Deleted project "${page.project_name}" (site_id: ${page.site_id}); purge ${enqueued ? "enqueued" : "NOT enqueued"}`,
    );

    return { success: true, purgeEnqueued: enqueued };
}
