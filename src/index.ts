import express from 'express'
import { log } from 'node:console'
import { createPage } from './controllers/pages/pageController.js'
import { restoreRoutes } from './../lib/caddy.js'
import { redis } from './../lib/redis.js'

const app = express()

app.use(express.json())

app.get("/", async (req, res) => {
    return res.json({
        message: "hello"
    })
})

app.post('/create_page', createPage)

// index.ts এ সরাসরি যোগ করো

app.post("/internal/log", async (req, res) => {
    const logs = Array.isArray(req.body) ? req.body : [req.body]
    const pipeline = redis.pipeline()

    for (const log of logs) {
        if (!log.host) continue
        pipeline.incr(`requests:${log.host}`)
        pipeline.incrby(`bandwidth:${log.host}`, log.bytes || 0)
    }

    await pipeline.exec()
    res.json({ ok: true })
})

app.get("/api/usage/:domain", async (req, res) => {
    const requests = parseInt(await redis.get(`requests:${req.params.domain}`) || "0")
    const bandwidth = parseInt(await redis.get(`bandwidth:${req.params.domain}`) || "0")

    res.json({
        requests: { used: requests, limit: 100_000 },
        bandwidth: { used_gb: (bandwidth / 1024 ** 3).toFixed(4), limit: "1GB" }
    })
})


app.listen(3000, async () => {
    log("server started at 3000")
    await restoreRoutes()
})
