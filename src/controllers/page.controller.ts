import type { Request, Response } from 'express'
import { createPage, getPageUsage } from '../services/page.service.js'
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
