import { db } from '../infrastructure/db/db.js'
import { blobTreeEntries, blobs, deployments, pages, sites } from '../infrastructure/db/schema.js'
import { and, eq, sql } from 'drizzle-orm'
import { customAlphabet } from 'nanoid'
import { redis } from '../infrastructure/cache/redis.js'
import { TOP_LEVEL_DOMAIN } from '../constants/index.js'
import { clearSiteFilesMap } from './deploy.service.js'
import type { CreatePageInput } from '../validators/page.validator.js'

export async function createPage(
    data: CreatePageInput,
    reqHeader: { tenant_name: string; tenant_id: string }
) {
    let { project_name } = data

    if (!reqHeader.tenant_id || !reqHeader.tenant_name) {
        return { message: 'token is not valid' }
    }

    // Ensure subdomain uniqueness — append a short random suffix if taken
    const nanoid = customAlphabet('abcdefghijklmnopqrstuvwxyz1234567890')
    const existingSite = await db.select().from(sites).where(eq(sites.subdomain, project_name))
    if (existingSite.length > 0) {
        project_name = `${project_name}${nanoid(4)}`.toLowerCase()
    }

    const domain = `${project_name}.${TOP_LEVEL_DOMAIN}`

    // 1. Insert into `sites` — this is what the caddy plugin reads.
    //    The returned UUID (site_id) is the MinIO key prefix.
    const [site] = await db.insert(sites).values({
        subdomain: project_name,
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

    // 3. The caddy static_s3 plugin routes via Redis site_files:{site_id}
    //    → blobs/{sha256}. No per-tenant Caddy config or tenant/ prefix needed.

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

export async function getPageUsage(domain: string) {
    const dbCacheKey = `db_cache:${domain}`
    let dbRequests = 0
    let dbBandwidth = 0
    let requestLimit = 100_000
    let bandwidthLimit = 2147483648

    const [page] = await db
        .select({
            id: pages.id,
            request: pages.request,
            bandwidth_usage: pages.bandwidth_usage,
            request_limit: pages.request_limit,
            bandwidth_limit: pages.bandwidth_limit,
        })
        .from(pages)
        .where(eq(pages.domain, domain))
        .limit(1)

    if (!page) return null

    requestLimit = Number(page.request_limit) || 100_000
    bandwidthLimit = Number(page.bandwidth_limit) || 2147483648

    const cachedDb = await redis.get(dbCacheKey)
    if (cachedDb) {
        const parsed = JSON.parse(cachedDb) as { request: number; bandwidth_usage: number }
        dbRequests = parsed.request
        dbBandwidth = parsed.bandwidth_usage
    } else {
        dbRequests = Number(page.request) || 0
        dbBandwidth = Number(page.bandwidth_usage) || 0

        await redis.set(
            dbCacheKey,
            JSON.stringify({ request: dbRequests, bandwidth_usage: dbBandwidth }),
            'EX',
            900
        )
    }

    const [liveReq, liveBw] = await Promise.all([
        redis.get(`requests:${domain}`),
        redis.get(`bandwidth:${domain}`),
    ])

    const liveRequests = parseInt(liveReq || '0', 10) || 0
    const liveBandwidth = parseInt(liveBw || '0', 10) || 0
    const totalRequests = dbRequests + liveRequests
    const totalBandwidth = dbBandwidth + liveBandwidth
    const storage = await getActiveDeploymentStorage(page.id)

    return {
        requests: {
            used: totalRequests,
            limit: requestLimit,
            flushed: dbRequests,
            live: liveRequests,
        },
        bandwidth: {
            used_bytes: totalBandwidth,
            used_gb: (totalBandwidth / 1024 ** 3).toFixed(6),
            flushed_bytes: dbBandwidth,
            live_bytes: liveBandwidth,
            limit_bytes: bandwidthLimit,
            limit: formatBytes(bandwidthLimit),
        },
        storage: {
            bytes: storage.bytes,
            human: storage.human,
            file_count: storage.fileCount,
        },
        sync: {
            pending_flush: liveRequests > 0 || liveBandwidth > 0,
            interval_seconds: 120,
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

    await redis.del(`site:${page.project_name}`)
    await clearSiteFilesMap(page.site_id)

    // 3. Clear usage caches
    await redis.del(`db_cache:${page.domain}`)
    await redis.del(`requests:${page.domain}`)
    await redis.del(`bandwidth:${page.domain}`)

    console.log(`🗑️  Deleted project "${page.project_name}" (site_id: ${page.site_id})`)

    return { success: true }
}
