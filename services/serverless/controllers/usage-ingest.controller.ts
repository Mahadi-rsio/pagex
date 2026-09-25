import type { MiddlewareHandler } from 'hono'
import { ingestUsage, parseIngestBody } from '../services/usage-ingest.service.js'
import type { AppEnv } from '../types.js'
import type { AppContext } from '../utils/http.js'

const TOKEN = process.env.USAGE_INGEST_TOKEN ?? ''

/** Constant-time token comparison to avoid leaking the secret via timing. */
function tokensEqual(a: string, b: string): boolean {
    if (a.length !== b.length) return false
    let diff = 0
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
    return diff === 0
}

/**
 * Token auth for the internal ingest endpoint. This is intentionally distinct
 * from the public JWT authMiddleware and is only for inter-service (Vector →
 * API) traffic.
 */
export const ingestAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
    if (!TOKEN) {
        return c.json({ error: 'USAGE_INGEST_TOKEN not configured' }, 500)
    }
    const header = c.req.header('authorization')
    if (typeof header !== 'string' || !header.startsWith('Bearer ')) {
        return c.json({ error: 'Unauthorized' }, 401)
    }
    const token = header.slice('Bearer '.length)
    if (!tokensEqual(token, TOKEN)) {
        return c.json({ error: 'Unauthorized' }, 401)
    }
    return next()
}

/**
 * POST /internal/usage/ingest
 * Accepts a JSON array (or newline-delimited JSON) of pre-aggregated hourly
 * records and applies them transactionally. Returns the count applied/skipped.
 */
export async function ingestUsageHandler(c: AppContext) {
    let body: string
    try {
        body = await c.req.text()
    } catch {
        return c.json({ error: 'Empty body' }, 400)
    }

    if (typeof body !== 'string' || body.trim().length === 0) {
        return c.json({ error: 'Empty body' }, 400)
    }

    // Accept either a JSON array or newline-delimited JSON. Try the array form
    // first; fall back to NDJSON line-by-line parsing.
    let records: unknown[]
    try {
        records = parseIngestBody(JSON.parse(body))
    } catch {
        records = parseIngestBody(body)
    }

    if (records.length === 0) {
        return c.json({ error: 'No valid records in payload' }, 400)
    }

    try {
        const result = await ingestUsage(records)
        return c.json({ ok: true, ...result }, 200)
    } catch (err) {
        console.error('[usage-ingest] failed:', (err as Error).message)
        return c.json({ error: 'Failed to ingest usage' }, 500)
    }
}