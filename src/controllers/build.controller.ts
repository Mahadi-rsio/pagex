import type { Request, Response } from 'express'
import { triggerCloudBuild, getBuildStatus, listBuilds } from '../services/build.service.js'
import { triggerBuildSchema } from '../validators/build.validator.js'

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
