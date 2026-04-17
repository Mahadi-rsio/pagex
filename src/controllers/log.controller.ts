import type { Request, Response } from 'express'
import { queue as LogQueue } from '../queue/jobs/log.job.js'

export async function internalLogHandler(req: Request, res: Response) {
    const logs = Array.isArray(req.body) ? req.body : [req.body]
    await LogQueue.add("process_logs", { logs })
    res.json({ ok: true })
}
