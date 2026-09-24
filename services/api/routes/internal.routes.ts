import { Router } from 'express'
import { ingestAuth, ingestUsageHandler } from '../controllers/usage-ingest.controller.js'

/**
 * Internal-only routes, mounted before the global JSON body parser and rate
 * limiter in app.ts. The ingest endpoint reads the raw body itself (NDJSON or
 * JSON array) and is protected by its own bearer-token auth.
 */
const router = Router()

router.post('/usage/ingest', ingestAuth, ingestUsageHandler)

export default router
