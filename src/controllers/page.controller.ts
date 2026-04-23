import type { Request, Response } from 'express'
import { createPage, deletePage, getListPages, getPageUsage } from '../services/page.service.js'
import { createPageSchema } from '../validators/page.validator.js'

export async function createPageHandler(req: Request, res: Response) {
    const validate = createPageSchema.safeParse(req.body)
    if (!validate.success) {
        return res.status(400).json({ error: validate.error.format() })
    }

    try {
        const page = await createPage({
            project_name: validate.data.project_name,

        }, {
            tenant_id: (req as any).id,
            tenant_name: (req as any).name
        })
        return res.json(page)
    } catch (err) {
        console.error(err)
        return res.status(500).json({ error: "Internal Server Error" })
    }
}

export async function getUsageHandler(req: Request, res: Response) {
    const domain = req.params['domain'] as string

    try {
        const usage = await getPageUsage(domain)

        if (!usage) {
            return res.status(404).json({ error: "Domain not found" })
        }

        return res.json(usage)
    } catch (err) {
        console.error('Usage fetch failed for', domain, ':', err)
        return res.status(500).json({ error: "Failed to fetch usage" })
    }
}





export async function getListPagesHandler(req: Request, res: Response) {
    try {
        const tenantId = (req as any).id
        if (!tenantId) return res.status(401).json({ error: 'Unauthorized' })

        const result = await getListPages(tenantId)
        return res.json(result)
    } catch (err) {
        console.error(err)
        return res.status(500).json({ error: 'Internal Server Error' })
    }
}

export async function deletePageHandler(req: Request, res: Response) {
    try {
        const tenantId = (req as any).id
        const pageId = req.params['id'] as string

        if (!tenantId) return res.status(401).json({ error: 'Unauthorized' })
        if (!pageId) return res.status(400).json({ error: 'Page ID required' })

        const result = await deletePage(pageId, tenantId)

        if ('error' in result) {
            const status = result.error === 'Forbidden' ? 403 : 404
            return res.status(status).json(result)
        }

        return res.json(result)
    } catch (err) {
        console.error(err)
        return res.status(500).json({ error: 'Internal Server Error' })
    }
}
