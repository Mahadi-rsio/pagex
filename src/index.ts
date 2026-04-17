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
import { authMiddleware } from './middleware/auth.middleware.js'
import multer from 'multer'
import { queue as UploadQueue } from './queue/queues/upload.queue.js'

// index.ts — top of file
import { mkdirSync } from 'fs'
mkdirSync('temp_zips', { recursive: true })

const app = express()
const upload = multer({ dest: 'temp_zips/' });

app.use(express.json({ limit: "100mb" }))


app.post('/upload/:bucket', authMiddleware, upload.single('file'), async (req, res) => {
    const { bucket } = req.params

    if (!bucket || Array.isArray(bucket)) {
        return res.status(400).json({ error: "Invalid bucket" });
    }


    try {
        if (!req.file) return res.status(400).send('No file uploaded.');

        const job = await UploadQueue.add('process-zip', {
            path: req.file.path,
            bucket_name: bucket
        }, {
            attempts: 3,
            backoff: { type: 'exponential', delay: 5000 }
        });

        res.json({
            success: true,
            message: 'File queued for processing',
            jobId: job.id
        });
    } catch (error) {
        res.status(500).json({ error: error });
    }
});

app.get("/", authMiddleware, async (req, res) => {
    return res.json({
        message: "hello"
    })
})

app.get("/api/usage/:domain", async (req, res) => {
    const domain = req.params.domain;
    const dbCacheKey = `db_cache:${domain}`;

    try {
        // 1. Cache only the DB totals (heavy part), not the computed result
        let dbRequests = 0;
        let dbBandwidth = 0;

        const cachedDb = await redis.get(dbCacheKey);
        if (cachedDb) {
            const parsed = JSON.parse(cachedDb);
            dbRequests = parsed.request;
            dbBandwidth = parsed.bandwidth_usage;
        } else {
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

            dbRequests = Number(page[0]?.request) || 0;
            dbBandwidth = Number(page[0]?.bandwidth_usage) || 0;

            // Cache only DB totals — TTL 15min matches sync window
            await redis.set(dbCacheKey, JSON.stringify({
                request: dbRequests,
                bandwidth_usage: dbBandwidth
            }), "EX", 900);
        }

        // 2. Always read live delta fresh — never cached
        const [liveReq, liveBw] = await Promise.all([
            redis.get(`requests:${domain}`),
            redis.get(`bandwidth:${domain}`)
        ]);

        const totalRequests = dbRequests + parseInt(liveReq || "0");
        const totalBandwidth = dbBandwidth + parseInt(liveBw || "0");

        return res.json({
            requests: { used: totalRequests, limit: 100_000 },
            bandwidth: {
                used_gb: (totalBandwidth / 1024 ** 3).toFixed(6),
                limit: "1GB"
            }
        });

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

app.get('/upload/status/:jobId', async (req, res) => {
    const { jobId } = req.params

    try {
        const job = await UploadQueue.getJob(jobId)

        if (!job) {
            return res.status(404).json({ error: 'Job not found' })
        }

        const state = await job.getState()

        return res.json({
            jobId: job.id,
            state,
            failedReason: job.failedReason || null
        })

    } catch (err) {
        return res.status(500).json({ error: 'Failed to fetch job status' })
    }
})

app.listen(3000, async () => {
    log("server started at 3000")


    await restoreRoutes()


    await SyncQueue.add("sync-usage", {},
        {
            jobId: "sync-logs-cron",
            repeat: {
                pattern: "0 */2 * * * *", // every 5 min
            },
        }
    );



})
