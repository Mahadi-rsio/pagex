import type { Request, Response } from 'express'
import { queue as UploadQueue } from '../queue/jobs/upload.job.js'
import { db } from '../infrastructure/db/db.js'
import { pages } from '../infrastructure/db/schema.js'
import { eq } from 'drizzle-orm'

export async function uploadFileHandler(req: Request, res: Response) {
    // The route is POST /api/upload/:pageId
    // We look up the page to get its site_id (the shared-bucket prefix)
    const { pageId } = req.params
    const tenantId = (req as any).id

    if (!pageId) {
        return res.status(400).json({ error: 'Page ID is required' })
    }

    try {
        if (!req.file) return res.status(400).send('No file uploaded.')

        // Verify ownership and fetch site_id
        const [page] = await db
            .select()
            .from(pages)
            .where(eq(pages.id, pageId as string))
            .limit(1)

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
