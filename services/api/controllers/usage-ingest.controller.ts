import type { NextFunction, Request, Response } from 'express'
import { ingestUsage, parseIngestBody } from '../services/usage-ingest.service.js'

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
export function ingestAuth(req: Request, res: Response, next: NextFunction) {
    if (!TOKEN) {
        return res.status(500).json({ error: 'USAGE_INGEST_TOKEN not configured' })
    }
    const header = req.headers['authorization']
    if (typeof header !== 'string' || !header.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Unauthorized' })
    }
    const token = header.slice('Bearer '.length)
    if (!tokensEqual(token, TOKEN)) {
        return res.status(401).json({ error: 'Unauthorized' })
    }
    return next()
}

/**
 * POST /internal/usage/ingest
 * Accepts a JSON array (or newline-delimited JSON) of pre-aggregated hourly
 * records and applies them transactionally. Returns the count applied/skipped.
 */
export async function ingestUsageHandler(req: Request, res: Response) {
    const body = req.body
    if (typeof body !== 'string' || body.trim().length === 0) {
        return res.status(400).json({ error: 'Empty body' })
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
        return res.status(400).json({ error: 'No valid records in payload' })
    }

    try {
        const result = await ingestUsage(records)
        return res.status(200).json({ ok: true, ...result })
    } catch (err) {
        console.error('[usage-ingest] failed:', (err as Error).message)
        return res.status(500).json({ error: 'Failed to ingest usage' })
    }
}
