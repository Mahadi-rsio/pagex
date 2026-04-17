import type { Request, Response } from 'express'
import { queue as UploadQueue } from '../queue/jobs/upload.job.js'

export async function uploadFileHandler(req: Request, res: Response) {
    const { bucket } = req.params

    if (!bucket || Array.isArray(bucket)) {
        return res.status(400).json({ error: "Invalid bucket" });
    }

    try {
        if (!req.file) return res.status(400).send('No file uploaded.');

        const job = await UploadQueue.add('process-zip', {
            path: req.file.path,
            bucket_name: bucket
        }, {
            attempts: 3,
            backoff: { type: 'exponential', delay: 5000 }
        });

        res.json({
            success: true,
            message: 'File queued for processing',
            jobId: job.id
        });
    } catch (error) {
        res.status(500).json({ error });
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
            failedReason: job.failedReason || null
        })
    } catch (err) {
        return res.status(500).json({ error: 'Failed to fetch job status' })
    }
}
