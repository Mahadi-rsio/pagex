import type { Request, Response } from 'express'
import { triggerCloudBuild, getBuildStatus, listBuilds } from '../services/build.service.js'
import { triggerBuildSchema } from '../validators/build.validator.js'
import { buildQueue } from '../queue/jobs/build.queue.js'

export async function triggerBuildHandler(req: Request, res: Response) {
    const validate = triggerBuildSchema.safeParse(req.body)
    if (!validate.success) {
        return res.status(400).json({ error: validate.error.format() })
    }

    const tenantId = (req as any).id
    if (!tenantId) return res.status(401).json({ error: 'Unauthorized' })

    try {
        const build = await triggerCloudBuild({
            ...validate.data,
            tenantId,
        })
        return res.status(201).json(build)
    } catch (err: any) {
        console.error('Trigger build failed:', err)
        const status = err.status || 500
        return res.status(status).json({ error: err.message || 'Internal Server Error' })
    }
}

export async function getBuildStatusHandler(req: Request, res: Response) {
    const buildId = req.params['buildId'] as string
    const tenantId = (req as any).id

    if (!buildId) {
        return res.status(400).json({ error: 'Build ID is required' })
    }
    if (!tenantId) return res.status(401).json({ error: 'Unauthorized' })

    try {
        const build = await getBuildStatus(buildId, tenantId)
        return res.json(build)
    } catch (err: any) {
        console.error('Get build status failed:', err)
        const status = err.status || 500
        return res.status(status).json({ error: err.message || 'Internal Server Error' })
    }
}

export async function listBuildsHandler(req: Request, res: Response) {
    const pageId = req.params['pageId'] as string
    const tenantId = (req as any).id

    if (!pageId) {
        return res.status(400).json({ error: 'Page ID is required' })
    }
    if (!tenantId) return res.status(401).json({ error: 'Unauthorized' })

    try {
        const buildsList = await listBuilds(pageId, tenantId)
        return res.json(buildsList)
    } catch (err: any) {
        console.error('List builds failed:', err)
        const status = err.status || 500
        return res.status(status).json({ error: err.message || 'Internal Server Error' })
    }
}

/**
 * GET /api/builds/:buildId/logs
 * Streams BullMQ job logs as Server-Sent Events.
 * Events:
 *   { type: "log",      message: string }
 *   { type: "progress", value: number }
 *   { type: "status",   status: string }
 *   { type: "done",     status: "completed"|"failed", error?: string }
 */
export async function getBuildLogsSSEHandler(req: Request, res: Response) {
    const buildId = req.params['buildId'] as string
    const tenantId = (req as any).id

    if (!buildId) return res.status(400).json({ error: 'Build ID is required' })
    if (!tenantId) return res.status(401).json({ error: 'Unauthorized' })

    let build: Awaited<ReturnType<typeof getBuildStatus>>
    try {
        build = await getBuildStatus(buildId, tenantId)
    } catch (err: any) {
        return res.status(err.status || 500).json({ error: err.message })
    }

    // SSE headers
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.setHeader('X-Accel-Buffering', 'no')  // disable Nginx buffering if behind proxy
    res.flushHeaders()

    const send = (payload: object) => {
        res.write(`data: ${JSON.stringify(payload)}\n\n`)
    }

    // If already terminal, just return current state immediately
    if (build.status === 'completed' || build.status === 'failed') {
        const durationMs = build.completed_at && build.created_at
            ? new Date(build.completed_at).getTime() - new Date(build.created_at).getTime()
            : undefined;
        send({ type: 'done', status: build.status, error: build.error ?? undefined, durationMs })
        return res.end()
    }

    let lastLogIndex = 0

    const interval = setInterval(async () => {
        try {
            const currentBuild = await getBuildStatus(buildId, tenantId)
            const jobId = currentBuild.job_id

            if (jobId) {
                    // Stream new log lines since last poll
                    const { logs } = await buildQueue.getJobLogs(jobId, lastLogIndex)
                    for (const line of logs) {
                        send({ type: 'log', message: line })
                        lastLogIndex++
                    }

                    const job = await buildQueue.getJob(jobId)
                    if (job) {
                        const progress = typeof job.progress === 'number' ? job.progress : 0
                        send({ type: 'progress', value: progress })
                    }
            }

            // Send status
            send({ type: 'status', status: currentBuild.status })

            // Close stream when terminal
            if (currentBuild.status === 'completed' || currentBuild.status === 'failed') {
                const durationMs = currentBuild.completed_at && currentBuild.created_at
                    ? new Date(currentBuild.completed_at).getTime() - new Date(currentBuild.created_at).getTime()
                    : undefined;
                send({ type: 'done', status: currentBuild.status, error: currentBuild.error ?? undefined, durationMs })
                clearInterval(interval)
                res.end()
            }
        } catch (err: any) {
            send({ type: 'error', message: err.message })
            clearInterval(interval)
            res.end()
        }
    }, 1000)

    // Clean up when the client disconnects
    req.on('close', () => clearInterval(interval))
}
