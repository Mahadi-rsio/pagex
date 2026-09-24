import express from 'express'
import rateLimit from 'express-rate-limit'
import RedisStore from 'rate-limit-redis'
import { redis } from './infrastructure/cache/redis.js'
import routes from './routes/index.js'
import internalRoutes from './routes/internal.routes.js'
import { RATE_LIMIT_WINDOW_MS, RATE_LIMIT_MAX } from './constants/index.js'

const app = express()

app.set('trust proxy', 1)

// Internal-only routes (Vector → API ingest) are mounted BEFORE the global JSON
// body parser and public rate limiter. The ingest handler parses its own raw
// body (JSON array / NDJSON) and is protected by bearer-token auth.
app.use('/internal', express.text({ limit: '50mb', type: () => true }), internalRoutes)

app.use(express.json({ limit: "100mb" }))

const limiter = rateLimit({
    windowMs: RATE_LIMIT_WINDOW_MS,
    max: RATE_LIMIT_MAX,
    standardHeaders: true,
    legacyHeaders: false,
    store: new RedisStore({
        sendCommand: (...args: string[]) => redis.call(...args as [string, ...string[]]) as any
    })
})

app.use(limiter)

app.use(routes)

export default app
