
import { redis } from "./../../lib/redis.js"
import { eq, sql } from "drizzle-orm"
import { db } from './../../lib/db/db.js'
import { pages } from './../../lib/db/schema.js'

export async function syncUsageToDB() {

    const keys = await redis.keys("requests:*")

    for (const key of keys) {
        const domain = key.replace("requests:", "")
        const requests = parseInt(await redis.get(key) || "0")
        const bandwidth = parseInt(await redis.get(`bandwidth:${domain}`) || "0")

        if (requests === 0) continue

        await db.update(pages)
            .set({
                request: sql`${pages.request} + ${requests}`,
                bandwidth_usage: sql`${pages.bandwidth_usage} + ${bandwidth}`
            })
            .where(eq(pages.domain, domain))
            .catch(() => { }) // domain না থাকলে ignore

        // Redis reset করো
        await redis.set(`requests:${domain}`, 0)
        await redis.set(`bandwidth:${domain}`, 0)

        console.log(`✅ Synced ${domain}: ${requests} reqs, ${bandwidth} bytes`)
    }
}

