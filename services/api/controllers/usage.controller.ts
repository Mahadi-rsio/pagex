import type { Request, Response } from 'express'
import {
    getAccountQuota,
    getAccountUsage,
    getProjectUsage,
    getSiteMetrics,
    getSiteUsage,
} from '../services/usage.service.js'
import { resolveMetricsWindow } from '../utils/metrics.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function tenantId(req: Request): string | null {
    const id = (req as any).id
    return typeof id === 'string' && id.length > 0 ? id : null
}

export async function getSiteUsageHandler(req: Request, res: Response) {
    const id = tenantId(req)
    if (!id) return res.status(401).json({ error: 'Unauthorized' })

    const siteId = req.params['siteId'] as string
    if (!UUID_RE.test(siteId)) return res.status(400).json({ error: 'Invalid site id' })

    try {
        const usage = await getSiteUsage(siteId, id)
        if (!usage) return res.status(404).json({ error: 'Site not found' })
        return res.json(usage)
    } catch (err) {
        console.error('Site usage failed for', siteId, ':', err)
        return res.status(500).json({ error: 'Failed to fetch usage' })
    }
}

export async function getProjectUsageHandler(req: Request, res: Response) {
    const id = tenantId(req)
    if (!id) return res.status(401).json({ error: 'Unauthorized' })

    const projectId = req.params['projectId'] as string
    if (!UUID_RE.test(projectId)) return res.status(400).json({ error: 'Invalid project id' })

    try {
        const usage = await getProjectUsage(projectId, id)
        if (!usage) return res.status(404).json({ error: 'Project not found' })
        return res.json(usage)
    } catch (err) {
        console.error('Project usage failed for', projectId, ':', err)
        return res.status(500).json({ error: 'Failed to fetch usage' })
    }
}

export async function getAccountUsageHandler(req: Request, res: Response) {
    const id = tenantId(req)
    if (!id) return res.status(401).json({ error: 'Unauthorized' })

    try {
        return res.json(await getAccountUsage(id))
    } catch (err) {
        console.error('Account usage failed:', err)
        return res.status(500).json({ error: 'Failed to fetch usage' })
    }
}

export async function getAccountQuotaHandler(req: Request, res: Response) {
    const id = tenantId(req)
    if (!id) return res.status(401).json({ error: 'Unauthorized' })

    try {
        return res.json(await getAccountQuota(id))
    } catch (err) {
        console.error('Account quota failed:', err)
        return res.status(500).json({ error: 'Failed to fetch quota' })
    }
}

export async function getSiteMetricsHandler(req: Request, res: Response) {
    const id = tenantId(req)
    if (!id) return res.status(401).json({ error: 'Unauthorized' })

    const siteId = req.params['siteId'] as string
    if (!UUID_RE.test(siteId)) return res.status(400).json({ error: 'Invalid site id' })

    const query: { window?: string; from?: string; to?: string } = {}
    if (typeof req.query['window'] === 'string') query.window = req.query['window']
    if (typeof req.query['from'] === 'string') query.from = req.query['from']
    if (typeof req.query['to'] === 'string') query.to = req.query['to']
    const window = resolveMetricsWindow(query)

    try {
        const metrics = await getSiteMetrics(siteId, id, window)
        if (!metrics) return res.status(404).json({ error: 'Site not found' })
        return res.json({
            ...metrics,
            window: { start: window.start.toISOString(), end: window.end.toISOString() },
        })
    } catch (err) {
        console.error('Site metrics failed for', siteId, ':', err)
        return res.status(500).json({ error: 'Failed to fetch metrics' })
    }
}
