import { Router } from 'express'
import {
    getAccountQuotaHandler,
    getAccountUsageHandler,
    getProjectUsageHandler,
    getSiteMetricsHandler,
    getSiteUsageHandler,
} from '../controllers/usage.controller.js'
import { authMiddleware } from '../middleware/auth.middleware.js'

const router = Router()

router.get('/api/v1/sites/:siteId/usage', authMiddleware, getSiteUsageHandler)
router.get('/api/v1/sites/:siteId/metrics', authMiddleware, getSiteMetricsHandler)
router.get('/api/v1/projects/:projectId/usage', authMiddleware, getProjectUsageHandler)
router.get('/api/v1/account/usage', authMiddleware, getAccountUsageHandler)
router.get('/api/v1/account/quota', authMiddleware, getAccountQuotaHandler)

export default router
