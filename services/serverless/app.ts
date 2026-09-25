import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import routes from './routes/index.js'
import internalRoutes from './routes/internal.routes.js'
import { RATE_LIMIT_WINDOW_MS, RATE_LIMIT_MAX } from './constants/index.js'
import { createRateLimiter } from './utils/rate-limiter.js'
import type { AppEnv } from './types.js'

// Internal-only routes (Vector → API ingest) are mounted WITHOUT the global
// body limit and rate limiter. The ingest handler parses its own raw body
// (JSON array / NDJSON) and is protected by its own bearer-token auth.
const app = new Hono<AppEnv>()
const internalApp = new Hono<AppEnv>()
const publicApp = new Hono<AppEnv>()

internalApp.use('*', bodyLimit({ maxSize: 50 * 1024 * 1024 }))
internalApp.route('/', internalRoutes)

publicApp.use('*', bodyLimit({ maxSize: 100 * 1024 * 1024 }))
publicApp.use(
    '*',
    createRateLimiter({
        windowMs: RATE_LIMIT_WINDOW_MS,
        max: RATE_LIMIT_MAX,
    })
)
publicApp.route('/', routes)

app.route('/internal', internalApp)
app.route('/', publicApp)

export default app