import { db } from '../infrastructure/db/db.js'
import {
    blobTreeEntries,
    blobs,
    deployments,
    pages,
    siteDailyStats,
    sites,
} from '../infrastructure/db/schema.js'
import { and, eq, sql } from 'drizzle-orm'
import { customAlphabet } from 'nanoid'
import { redis } from '../infrastructure/cache/redis.js'
import { TOP_LEVEL_DOMAIN } from '../constants/index.js'
import { clearSiteFilesMap } from './deploy.service.js'
import { clearDeploymentRuntimeCache } from './manifest.service.js'
import type { CreatePageInput } from '../validators/page.validator.js'

export async function createPage(
    data: CreatePageInput,
    reqHeader: { tenant_name: string; tenant_id: string }
) {
    let { project_name } = data

    if (!reqHeader.tenant_id || !reqHeader.tenant_name) {
        return { message: 'token is not valid' }
    }

    // Subdomain format: {project_name}.{random_number} — always unique,
    // so projects never squat a bare slug. Random suffix is digits-only.
    const subdomainSuffix = customAlphabet('0123456789', 4)
    let subdomain = ''
    for (let attempt = 0; attempt < 5; attempt++) {
        const candidate = `${project_name.toLowerCase()}.${subdomainSuffix()}`
        const existing = await db
            .select({ id: sites.id })
            .from(sites)
            .where(eq(sites.subdomain, candidate))
            .limit(1)
        if (existing.length === 0) {
            subdomain = candidate
            break
        }
    }
    if (!subdomain) {
        throw new Error('Could not generate a unique subdomain')
    }

    const domain = `${subdomain}.${TOP_LEVEL_DOMAIN}`

    // 1. Insert into `sites` — this is what the caddy plugin reads.
    //    The returned UUID (site_id) is the MinIO key prefix.
    const [site] = await db.insert(sites).values({
        subdomain,
        active: true,
    }).returning()

    if (!site) throw new Error('Failed to create site record')

    // 2. Insert tenant project metadata into `pages`
    const [page] = await db.insert(pages).values({
        site_id: site.id,
        tenant_id: reqHeader.tenant_id,
        tenant_name: reqHeader.tenant_name,
        project_name,
        domain,
    }).returning()

    if (!page) throw new Error('Failed to create page record')

    // 3. The caddy static_s3 plugin resolves subdomain → site_id → active
    //    deployment manifest → blobs/{sha256}. No per-tenant Caddy config or
    //    tenant/ prefix needed.

    console.log(`✅ Created project "${project_name}" → site_id: ${site.id}`)

    return {
        ...page,
        site_id: site.id,
    }
}

function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`
    if (bytes < 1024 ** 3) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
    return `${(bytes / 1024 ** 3).toFixed(3)} GB`
}

function utcDateString(offsetDays = 0): string {
    const d = new Date()
    d.setUTCDate(d.getUTCDate() + offsetDays)
    return d.toISOString().slice(0, 10)
}

async function readLiveSiteStats(siteId: string) {
    // Blob-server analytics keys: stats:{site_id}:{YYYY-MM-DD}
    const dates = [utcDateString(0), utcDateString(-1)]
    let requests = 0
    let bandwidth = 0
    let bots = 0
    let humans = 0

    for (const day of dates) {
        const key = `stats:${siteId}:${day}`
        const vals = await redis.hgetall(key)
        if (!vals || Object.keys(vals).length === 0) continue
        requests += parseInt(vals.requests || '0', 10) || 0
        bandwidth += parseInt(vals.bandwidth || '0', 10) || 0
        bots += parseInt(vals.bots || '0', 10) || 0
        humans += parseInt(vals.humans || '0', 10) || 0
    }

    return { requests, bandwidth, bots, humans }
}

async function getActiveDeploymentStorage(pageId: string) {
    const [active] = await db
        .select({ id: deployments.id })
        .from(deployments)
        .where(and(eq(deployments.page_id, pageId), eq(deployments.is_active, true)))
        .limit(1)

    if (!active) {
        return { bytes: 0, fileCount: 0, human: '0 B' }
    }

    const [row] = await db
        .select({
            bytes: sql<number>`coalesce(sum(${blobs.size}), 0)::bigint`.mapWith(Number),
            fileCount: sql<number>`count(*)::int`.mapWith(Number),
        })
        .from(blobTreeEntries)
        .innerJoin(blobs, eq(blobTreeEntries.blobHash, blobs.hash))
        .where(eq(blobTreeEntries.deploymentId, active.id))

    const bytes = row?.bytes ?? 0
    return {
        bytes,
        fileCount: row?.fileCount ?? 0,
        human: formatBytes(bytes),
    }
}

/**
 * Usage from the blob-server analytics pipeline:
 * - Live: Redis `stats:{site_id}:{date}` (pending 5-min flush)
 * - Flushed: PostgreSQL `site_daily_stats`
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
        .where(eq(pages.domain, domain))
        .limit(1)

    if (!page) return null

    const requestLimit = Number(page.request_limit) || 100_000
    const bandwidthLimit = Number(page.bandwidth_limit) || 2147483648

    const [flushedRow] = await db
        .select({
            requests: sql<number>`coalesce(sum(${siteDailyStats.requests}), 0)::bigint`.mapWith(Number),
            bandwidth: sql<number>`coalesce(sum(${siteDailyStats.bandwidth}), 0)::bigint`.mapWith(Number),
            bots: sql<number>`coalesce(sum(${siteDailyStats.bots}), 0)::bigint`.mapWith(Number),
            humans: sql<number>`coalesce(sum(${siteDailyStats.humans}), 0)::bigint`.mapWith(Number),
        })
        .from(siteDailyStats)
        .where(eq(siteDailyStats.siteId, page.site_id))

    const flushedRequests = flushedRow?.requests ?? 0
    const flushedBandwidth = flushedRow?.bandwidth ?? 0
    const live = await readLiveSiteStats(page.site_id)

    const totalRequests = flushedRequests + live.requests
    const totalBandwidth = flushedBandwidth + live.bandwidth
    const storage = await getActiveDeploymentStorage(page.id)

    return {
        requests: {
            used: totalRequests,
            limit: requestLimit,
            flushed: flushedRequests,
            live: live.requests,
        },
        bandwidth: {
            used_bytes: totalBandwidth,
            used_gb: (totalBandwidth / 1024 ** 3).toFixed(6),
            flushed_bytes: flushedBandwidth,
            live_bytes: live.bandwidth,
            limit_bytes: bandwidthLimit,
            limit: formatBytes(bandwidthLimit),
        },
        storage: {
            bytes: storage.bytes,
            human: storage.human,
            file_count: storage.fileCount,
        },
        sync: {
            pending_flush: live.requests > 0 || live.bandwidth > 0,
            interval_seconds: 300,
        },
        traffic: {
            bots: (flushedRow?.bots ?? 0) + live.bots,
            humans: (flushedRow?.humans ?? 0) + live.humans,
        },
    }
}

export async function getListPages(tenantId: string) {
    const result = await db.select().from(pages).where(eq(pages.tenant_id, tenantId))
    return result
}

export async function deletePage(pageId: string, tenantId: string) {
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    if (!UUID_RE.test(pageId)) return { error: 'Page not found' }

    // Verify ownership
    const existing = await db
        .select()
        .from(pages)
        .where(eq(pages.id, pageId))
        .limit(1)

    if (!existing.length) return { error: 'Page not found' }
    if (existing[0]!.tenant_id !== tenantId) return { error: 'Forbidden' }

    const page = existing[0]!

    // 1. Delete pages row (cascades deployments / blob_tree_entries / builds)
    await db.delete(pages).where(eq(pages.id, pageId))

    // 2. Deactivate the site in the `sites` table and invalidate Redis caches
    //    so the caddy plugin immediately stops routing this subdomain.
    await db
        .update(sites)
        .set({ active: false })
        .where(eq(sites.id, page.site_id))

    const [site] = await db
        .select({ subdomain: sites.subdomain })
        .from(sites)
        .where(eq(sites.id, page.site_id))
        .limit(1)

    await redis.del(`site:${site?.subdomain ?? page.project_name}`)
    await clearSiteFilesMap(page.site_id)
    await clearDeploymentRuntimeCache(page.site_id)
    await redis.del(`site_version:${page.site_id}`)

    // 3. Clear usage caches
    await redis.del(`db_cache:${page.domain}`)
    await redis.del(`requests:${page.domain}`)
    await redis.del(`bandwidth:${page.domain}`)

    console.log(`🗑️  Deleted project "${page.project_name}" (site_id: ${page.site_id})`)

    return { success: true }
}
