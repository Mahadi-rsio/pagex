import express from 'express'
import { log } from 'node:console'
import { createPage } from './controllers/pages/pageController.js'
import { restoreRoutes } from './../lib/caddy.js'
import { redis } from './../lib/redis.js'
import { queue as LogQueue } from './queue/queues/log.queue.js'
import { queue as SyncQueue } from './queue/queues/sync.queue.js'
import { db } from './../lib/db/db.js'
import { pages } from './../lib/db/schema.js'
import { eq } from 'drizzle-orm'

const app = express()

app.use(express.json({ limit: "100mb" }))

app.get("/", async (req, res) => {
    return res.json({
        message: "hello"
    })
})

app.get("/api/usage/:domain", async (req, res) => {
    const domain = req.params.domain;
    const cacheKey = `usage_cache:${domain}`;

    try {
        // 1. Check computed cache
        const cached = await redis.get(cacheKey);
        if (cached) {
            return res.json(JSON.parse(cached));
        }

        // 2. Fetch DB historical totals
        const page = await db.select({
            request: pages.request,
            bandwidth_usage: pages.bandwidth_usage
        })
            .from(pages)
            .where(eq(pages.domain, domain))
            .limit(1);

        if (!page.length) {
            return res.status(404).json({ error: "Domain not found" });
        }

        const dbRequests = Number(page[0]?.request) || 0;
        const dbBandwidth = Number(page[0]?.bandwidth_usage) || 0;

        // 3. Get live unsync'd delta from Redis counters
        const [liveReq, liveBw] = await Promise.all([
            redis.get(`requests:${domain}`),
            redis.get(`bandwidth:${domain}`)
        ]);

        const deltaRequests = parseInt(liveReq || "0");
        const deltaBandwidth = parseInt(liveBw || "0");

        // 4. Real total = DB (already synced) + Redis (not yet synced)
        const totalRequests = dbRequests + deltaRequests;
        const totalBandwidth = dbBandwidth + deltaBandwidth;

        const payload = {
            requests: { used: totalRequests, limit: 100_000 },
            bandwidth: {
                used_gb: (totalBandwidth / 1024 ** 3).toFixed(6),
                limit: "1GB"
            }
        };

        // 5. Cache for 15 min (matches your sync window)
        await redis.set(cacheKey, JSON.stringify(payload), "EX", 900);

        return res.json(payload);

    } catch (err) {
        console.error(`Usage fetch failed for ${domain}:`, err);
        return res.status(500).json({ error: "Failed to fetch usage" });
    }
});


app.post('/create_page', createPage)



app.post("/internal/log", async (req, res) => {
    const logs = Array.isArray(req.body) ? req.body : [req.body]

    await LogQueue.add("process_logs", { logs })


    res.json({ ok: true })
})


app.listen(3000, async () => {
    log("server started at 3000")


    await restoreRoutes()


    await SyncQueue.add("sync-usage", {},
        {
            jobId: "sync-logs-cron",
            repeat: {
                pattern: "0 */15 * * * *", // every 5 min
            },
        }
    );



})
