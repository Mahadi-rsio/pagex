import type { Request, Response } from 'express'
import { rollbackToDeployment, listDeployments } from '../services/deployment.service.js'

export async function rollbackToDeploymentHandler(req: Request, res: Response) {
    const deploymentId = req.params['deploymentId'] as string
    const tenantId = (req as any).id

    if (!deploymentId) {
        return res.status(400).json({ error: 'Deployment ID is required' })
    }
    if (!tenantId) {
        return res.status(401).json({ error: 'Unauthorized' })
    }

    try {
        const deployment = await rollbackToDeployment(deploymentId, tenantId)
        return res.json({
            success: true,
            message: 'Rollback successful',
            deployment,
        })
    } catch (err: any) {
        console.error('Rollback failed:', err)
        const status = err.status || 500
        return res.status(status).json({ error: err.message || 'Internal Server Error' })
    }
}

export async function listDeploymentsHandler(req: Request, res: Response) {
    const pageId = req.params['pageId'] as string
    const tenantId = (req as any).id

    if (!pageId) {
        return res.status(400).json({ error: 'Page ID is required' })
    }
    if (!tenantId) {
        return res.status(401).json({ error: 'Unauthorized' })
    }

    try {
        const deploymentsList = await listDeployments(pageId, tenantId)
        return res.json(deploymentsList)
    } catch (err: any) {
        console.error('List deployments failed:', err)
        const status = err.status || 500
        return res.status(status).json({ error: err.message || 'Internal Server Error' })
    }
}
