import { createPage, deletePage, getListPages, getPageUsage } from '../services/page.service.js'
import { createPageSchema } from '../validators/page.validator.js'
import { readJson, tenantId, type AppContext } from '../utils/http.js'

export async function createPageHandler(c: AppContext) {
    const body = await readJson(c)
    const validate = createPageSchema.safeParse(body)
    if (!validate.success) {
        return c.json({ error: validate.error.format() }, 400)
    }

    const tenant = tenantId(c)
    const tenantName = c.get('name')
    if (!tenant || !tenantName) return c.json({ error: 'Unauthorized' }, 401)

    try {
        const page = await createPage(
            {
                project_name: validate.data.project_name,
            },
            {
                tenant_id: tenant,
                tenant_name: tenantName,
            }
        )
        return c.json(page)
    } catch (err) {
        console.error(err)
        return c.json({ error: "Internal Server Error" }, 500)
    }
}

export async function getUsageHandler(c: AppContext) {
    const domain = c.req.param('domain') ?? ''

    try {
        const usage = await getPageUsage(domain)

        if (!usage) {
            return c.json({ error: "Domain not found" }, 404)
        }

        return c.json(usage)
    } catch (err) {
        console.error('Usage fetch failed for', domain, ':', err)
        return c.json({ error: "Failed to fetch usage" }, 500)
    }
}

export async function getListPagesHandler(c: AppContext) {
    try {
        const tenant = tenantId(c)
        if (!tenant) return c.json({ error: 'Unauthorized' }, 401)

        const result = await getListPages(tenant)
        return c.json(result)
    } catch (err) {
        console.error(err)
        return c.json({ error: 'Internal Server Error' }, 500)
    }
}

export async function deletePageHandler(c: AppContext) {
    try {
        const tenant = tenantId(c)
        const pageIdParam = c.req.param('id')

        if (!tenant) return c.json({ error: 'Unauthorized' }, 401)
        if (!pageIdParam) return c.json({ error: 'Page ID required' }, 400)

        const result = await deletePage(pageIdParam, tenant)

        if ('error' in result) {
            const status = result.error === 'Forbidden' ? 403 : 404
            return c.json(result, status)
        }

        return c.json(result)
    } catch (err) {
        console.error(err)
        return c.json({ error: 'Internal Server Error' }, 500)
    }
}