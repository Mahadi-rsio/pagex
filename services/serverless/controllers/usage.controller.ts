import {
    getAccountQuota,
    getAccountUsage,
    getProjectUsage,
    getSiteMetrics,
    getSiteUsage,
} from '../services/usage.service.js'
import { resolveMetricsWindow } from '../utils/metrics.js'
import { tenantId, type AppContext } from '../utils/http.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function getSiteUsageHandler(c: AppContext) {
    const id = tenantId(c)
    if (!id) return c.json({ error: 'Unauthorized' }, 401)

    const siteId = c.req.param('siteId') ?? ''
    if (!UUID_RE.test(siteId)) return c.json({ error: 'Invalid site id' }, 400)

    try {
        const usage = await getSiteUsage(siteId, id)
        if (!usage) return c.json({ error: 'Site not found' }, 404)
        return c.json(usage)
    } catch (err) {
        console.error('Site usage failed for', siteId, ':', err)
        return c.json({ error: 'Failed to fetch usage' }, 500)
    }
}

export async function getProjectUsageHandler(c: AppContext) {
    const id = tenantId(c)
    if (!id) return c.json({ error: 'Unauthorized' }, 401)

    const projectId = c.req.param('projectId') ?? ''
    if (!UUID_RE.test(projectId)) return c.json({ error: 'Invalid project id' }, 400)

    try {
        const usage = await getProjectUsage(projectId, id)
        if (!usage) return c.json({ error: 'Project not found' }, 404)
        return c.json(usage)
    } catch (err) {
        console.error('Project usage failed for', projectId, ':', err)
        return c.json({ error: 'Failed to fetch usage' }, 500)
    }
}

export async function getAccountUsageHandler(c: AppContext) {
    const id = tenantId(c)
    if (!id) return c.json({ error: 'Unauthorized' }, 401)

    try {
        return c.json(await getAccountUsage(id))
    } catch (err) {
        console.error('Account usage failed:', err)
        return c.json({ error: 'Failed to fetch usage' }, 500)
    }
}

export async function getAccountQuotaHandler(c: AppContext) {
    const id = tenantId(c)
    if (!id) return c.json({ error: 'Unauthorized' }, 401)

    try {
        return c.json(await getAccountQuota(id))
    } catch (err) {
        console.error('Account quota failed:', err)
        return c.json({ error: 'Failed to fetch quota' }, 500)
    }
}

export async function getSiteMetricsHandler(c: AppContext) {
    const id = tenantId(c)
    if (!id) return c.json({ error: 'Unauthorized' }, 401)

    const siteId = c.req.param('siteId') ?? ''
    if (!UUID_RE.test(siteId)) return c.json({ error: 'Invalid site id' }, 400)

    const query: { window?: string; from?: string; to?: string } = {}
    const windowQuery = c.req.query('window')
    const fromQuery = c.req.query('from')
    const toQuery = c.req.query('to')
    if (typeof windowQuery === 'string') query.window = windowQuery
    if (typeof fromQuery === 'string') query.from = fromQuery
    if (typeof toQuery === 'string') query.to = toQuery
    const window = resolveMetricsWindow(query)

    try {
        const metrics = await getSiteMetrics(siteId, id, window)
        if (!metrics) return c.json({ error: 'Site not found' }, 404)
        return c.json({
            ...metrics,
            window: { start: window.start.toISOString(), end: window.end.toISOString() },
        })
    } catch (err) {
        console.error('Site metrics failed for', siteId, ':', err)
        return c.json({ error: 'Failed to fetch metrics' }, 500)
    }
}