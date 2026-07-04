import { db } from '../infrastructure/db/db.js'
import { pages, sites } from '../infrastructure/db/schema.js'
import { eq } from 'drizzle-orm'
import { customAlphabet } from 'nanoid'
import { minioClient, SHARED_BUCKET, deleteSiteObjects } from '../infrastructure/storage/minio.js'
import { redis } from '../infrastructure/cache/redis.js'
import { TOP_LEVEL_DOMAIN } from '../constants/index.js'
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

    // 3. The caddy static_s3 plugin now handles routing automatically —
    //    no Caddy admin API call needed. Files will be served from:
    //    {SHARED_BUCKET}/{site.id}/{filepath}

    console.log(`✅ Created project "${project_name}" → site_id: ${site.id}`)

    return {
        ...page,
        site_id: site.id,
    }
}

export async function getPageUsage(domain: string) {
    const dbCacheKey = `db_cache:${domain}`
    let dbRequests = 0
    let dbBandwidth = 0

    const cachedDb = await redis.get(dbCacheKey)
    if (cachedDb) {
        const parsed = JSON.parse(cachedDb) as { request: number; bandwidth_usage: number }
        dbRequests = parsed.request
        dbBandwidth = parsed.bandwidth_usage
    } else {
        const page = await db
            .select({
                request: pages.request,
                bandwidth_usage: pages.bandwidth_usage,
            })
            .from(pages)
            .where(eq(pages.domain, domain))
            .limit(1)

        if (!page.length) return null

        dbRequests = Number(page[0]!.request) || 0
        dbBandwidth = Number(page[0]!.bandwidth_usage) || 0

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

    const totalRequests = dbRequests + parseInt(liveReq || '0')
    const totalBandwidth = dbBandwidth + parseInt(liveBw || '0')

    return {
        requests: { used: totalRequests, limit: 100_000 },
        bandwidth: {
            used_gb: (totalBandwidth / 1024 ** 3).toFixed(6),
            limit: '1GB',
        },
    }
}

export async function getListPages(tenantId: string) {
    const result = await db.select().from(pages).where(eq(pages.tenant_id, tenantId))
    return result
}

export async function deletePage(pageId: string, tenantId: string) {
    // Verify ownership
    const existing = await db
        .select()
        .from(pages)
        .where(eq(pages.id, pageId))
        .limit(1)

    if (!existing.length) return { error: 'Page not found' }
    if (existing[0]!.tenant_id !== tenantId) return { error: 'Forbidden' }

    const page = existing[0]!

    // 1. Remove all files from the shared bucket under this site's prefix
    await deleteSiteObjects(page.site_id).catch(err =>
        console.error('MinIO object deletion failed:', err)
    )

    // 2. Delete pages row (cascades will also delete from site_daily_stats)
    await db.delete(pages).where(eq(pages.id, pageId))

    // 3. Deactivate the site in the `sites` table and invalidate Redis cache
    //    so the caddy plugin immediately stops routing this subdomain.
    await db
        .update(sites)
        .set({ active: false })
        .where(eq(sites.id, page.site_id))

    await redis.del(`site:${page.project_name}`)

    // 4. Clear usage caches
    await redis.del(`db_cache:${page.domain}`)
    await redis.del(`requests:${page.domain}`)
    await redis.del(`bandwidth:${page.domain}`)

    console.log(`🗑️  Deleted project "${page.project_name}" (site_id: ${page.site_id})`)

    return { success: true }
}
