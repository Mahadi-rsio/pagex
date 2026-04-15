import express from 'express'
import { log } from 'node:console'
import { createPage } from './controllers/pages/pageController.js'
import { restoreRoutes } from './../lib/caddy.js'
import { redis } from './../lib/redis.js'
import { queue as LogQueue } from './queue/queues/log.queue.js'
import { queue as SyncQueue } from './queue/queues/sync.queue.js'

const app = express()

app.use(express.json({ limit: "100mb" }))

app.get("/", async (req, res) => {
    return res.json({
        message: "hello"
    })
})



app.post('/create_page', createPage)


app.post("/internal/log", async (req, res) => {
    const logs = Array.isArray(req.body) ? req.body : [req.body]

    await LogQueue.add("process_logs", { logs })


    res.json({ ok: true })
})

app.get("/api/usage/:domain", async (req, res) => {
    const requests = parseInt(await redis.get(`requests:${req.params.domain}`) || "0")
    const bandwidth = parseInt(await redis.get(`bandwidth:${req.params.domain}`) || "0")

    res.json({
        requests: { used: requests, limit: 100_000 },
        bandwidth: { used_gb: (bandwidth / 1024 ** 3).toFixed(6), limit: "1GB" }
    })
})


app.listen(3000, async () => {
    log("server started at 3000")


    await restoreRoutes()


    await SyncQueue.add("sync-usage", {},
        {
            jobId: "sync-logs-cron",
            repeat: {
                pattern: "0 */5 * * * *", // every 5 min
            },
        }
    );



})
