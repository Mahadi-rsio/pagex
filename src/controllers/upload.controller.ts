import type { Request, Response } from 'express'
import { queue as UploadQueue } from '../queue/jobs/upload.job.js'
import { db } from '../infrastructure/db/db.js'
import { pages } from '../infrastructure/db/schema.js'
import { and, eq } from 'drizzle-orm'

export async function uploadFileHandler(req: Request, res: Response) {
    // The route is POST /upload/:pageId
    // :pageId can be either a UUID (page.id) or a project_name slug —
    // the CLI sends the project_name, so we support both.
    const param = req.params['pageId'] as string
    const tenantId = (req as any).id

    if (!param) {
        return res.status(400).json({ error: 'Page ID or project name is required' })
    }

    try {
        if (!req.file) return res.status(400).send('No file uploaded.')

        // Decide lookup strategy: UUID → by id, otherwise → by project_name + tenant
        const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
        const [page] = UUID_RE.test(param)
            ? await db.select().from(pages).where(eq(pages.id, param)).limit(1)
            : await db.select().from(pages).where(
                and(eq(pages.project_name, param), eq(pages.tenant_id, tenantId))
            ).limit(1)

        if (!page) return res.status(404).json({ error: 'Page not found' })
        if (page.tenant_id !== tenantId) return res.status(403).json({ error: 'Forbidden' })

        const job = await UploadQueue.add(
            'process-zip',
            {
                path: req.file.path,
                site_id: page.site_id,
            },
            {
                attempts: 3,
                backoff: { type: 'exponential', delay: 5000 },
            }
        )

        res.json({
            success: true,
            message: 'File queued for processing',
            jobId: job.id,
        })
    } catch (error) {
        res.status(500).json({ error })
    }
}

export async function getUploadStatusHandler(req: Request, res: Response) {
    const jobId = req.params['jobId'] as string

    try {
        const job = await UploadQueue.getJob(jobId)

        if (!job) {
            return res.status(404).json({ error: 'Job not found' })
        }

        const state = await job.getState()

        return res.json({
            jobId: job.id,
            state,
            failedReason: job.failedReason || null,
        })
    } catch (err) {
        return res.status(500).json({ error: 'Failed to fetch job status' })
    }
}
