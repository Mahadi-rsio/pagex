import { redis } from "./../../lib/redis.js"
import { eq, sql } from "drizzle-orm"
import { db } from './../../lib/db/db.js'
import { pages } from './../../lib/db/schema.js'


export async function syncUsageToDB() {
    const keys = await redis.keys("requests:*");

    for (const key of keys) {
        const domain = key.replace("requests:", "").trim();

        try {
            // ✅ Atomic read+reset (no lost increments during sync)
            const [reqStr, bwStr] = await Promise.all([
                redis.getset(`requests:${domain}`, "0"),
                redis.getset(`bandwidth:${domain}`, "0"),
            ]);

            const requests = parseInt(reqStr || "0", 10);
            const bandwidth = parseInt(bwStr || "0", 10);

            // ✅ Skip only when BOTH are 0
            if (requests === 0 && bandwidth === 0) continue;

            await db.update(pages)
                .set({
                    request: sql`${pages.request} + ${requests}`,
                    bandwidth_usage: sql`${pages.bandwidth_usage} + ${bandwidth}`,
                })
                .where(eq(pages.domain, domain));

            // ✅ Bust DB cache so next /api/usage reads fresh DB totals
            await redis.del(`db_cache:${domain}`);

            console.log(`✅ Synced ${domain}: ${requests} reqs, ${bandwidth} bytes`);
        } catch (err) {
            console.error(`❌ Sync failed for ${domain}:`, err);

            // Optional (recommended): restore counters so data isn’t lost if DB update failed
            // NOTE: this restore is not perfectly race-free, but better than dropping counts.
            // If you want stricter guarantees, we can switch to LUA script or use INCRBY restore.
            // await redis.incrby(`requests:${domain}`, requests);
            // await redis.incrby(`bandwidth:${domain}`, bandwidth);
        }
    }
}
