import { Hono } from 'hono'
import { authMiddleware } from '../middleware/auth.middleware.js'
import {
    rollbackToDeploymentHandler,
    listDeploymentsHandler,
    listPageDeploymentFilesHandler,
} from '../controllers/deployment.controller.js'

const router = new Hono()

router.post('/api/deployments/:deploymentId/rollback', authMiddleware, rollbackToDeploymentHandler)
router.get('/api/deployments/page/:pageId/files', authMiddleware, listPageDeploymentFilesHandler)
router.get('/api/deployments/page/:pageId', authMiddleware, listDeploymentsHandler)

export default router