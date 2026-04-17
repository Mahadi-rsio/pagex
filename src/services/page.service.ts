import { db } from '../infrastructure/db/db.js'
import { pages } from '../infrastructure/db/schema.js'
import { eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { createPageBucket } from '../infrastructure/storage/minio.js'
import { addCustomDomain } from '../infrastructure/proxy/caddy.js'
import { redis } from '../infrastructure/cache/redis.js'
import { TOP_LEVEL_DOMAIN } from '../constants/index.js'
import type { CreatePageInput } from '../validators/page.validator.js'

export async function createPage(data: CreatePageInput) {
    let { tenant_name, plan, project_name } = data

    const existing = await db.select().from(pages).where(eq(pages.project_name, project_name))

    if (existing.length > 0) {
        project_name = `${project_name}-${nanoid(4)}`.toLowerCase()
    }

    const domain = `${project_name}.${TOP_LEVEL_DOMAIN}`

    const insert = await db.insert(pages).values({
        tenant_name,
        plan,
        project_name,
        domain
    }).returning()

    await createPageBucket(project_name)

    addCustomDomain({
        tenantId: insert[0]!.id,
        projectName: insert[0]!.project_name,
        customDomain: insert[0]!.domain
    })

    console.log(`Added Domain ${insert[0]!.domain}`)

    return insert[0]!
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
        const page = await db.select({
            request: pages.request,
            bandwidth_usage: pages.bandwidth_usage
        })
            .from(pages)
            .where(eq(pages.domain, domain))
            .limit(1)

        if (!page.length) return null

        dbRequests = Number(page[0]!.request) || 0
        dbBandwidth = Number(page[0]!.bandwidth_usage) || 0

        await redis.set(dbCacheKey, JSON.stringify({
            request: dbRequests,
            bandwidth_usage: dbBandwidth
        }), "EX", 900)
    }

    const [liveReq, liveBw] = await Promise.all([
        redis.get(`requests:${domain}`),
        redis.get(`bandwidth:${domain}`)
    ])

    const totalRequests = dbRequests + parseInt(liveReq || "0")
    const totalBandwidth = dbBandwidth + parseInt(liveBw || "0")

    return {
        requests: { used: totalRequests, limit: 100_000 },
        bandwidth: {
            used_gb: (totalBandwidth / 1024 ** 3).toFixed(6),
            limit: "1GB"
        }
    }
}
