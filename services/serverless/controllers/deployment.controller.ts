import {
    rollbackToDeployment,
    listDeployments,
    listPageDeploymentFiles,
} from '../services/deployment.service.js'
import { respondError, tenantId, type AppContext } from '../utils/http.js'

export async function rollbackToDeploymentHandler(c: AppContext) {
    const deploymentId = c.req.param('deploymentId')
    const tenant = tenantId(c)

    if (!deploymentId) {
        return c.json({ error: 'Deployment ID is required' }, 400)
    }
    if (!tenant) {
        return c.json({ error: 'Unauthorized' }, 401)
    }

    try {
        const deployment = await rollbackToDeployment(deploymentId, tenant)
        return c.json({
            success: true,
            message: 'Rollback successful',
            deployment,
        })
    } catch (err) {
        console.error('Rollback failed:', err)
        return respondError(c, err)
    }
}

export async function listDeploymentsHandler(c: AppContext) {
    const pageId = c.req.param('pageId')
    const tenant = tenantId(c)

    if (!pageId) {
        return c.json({ error: 'Page ID is required' }, 400)
    }
    if (!tenant) {
        return c.json({ error: 'Unauthorized' }, 401)
    }

    try {
        const deploymentsList = await listDeployments(pageId, tenant)
        return c.json(deploymentsList)
    } catch (err) {
        console.error('List deployments failed:', err)
        return respondError(c, err)
    }
}

export async function listPageDeploymentFilesHandler(c: AppContext) {
    const pageId = c.req.param('pageId')
    const tenant = tenantId(c)

    if (!pageId) {
        return c.json({ error: 'Page ID is required' }, 400)
    }
    if (!tenant) {
        return c.json({ error: 'Unauthorized' }, 401)
    }

    try {
        const result = await listPageDeploymentFiles(pageId, tenant)
        return c.json(result)
    } catch (err) {
        console.error('List deployment files failed:', err)
        return respondError(c, err)
    }
}