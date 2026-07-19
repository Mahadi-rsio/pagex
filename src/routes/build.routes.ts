import { Router } from 'express'
import { authMiddleware } from '../middleware/auth.middleware.js'
import { triggerBuildHandler, getBuildStatusHandler, listBuildsHandler } from '../controllers/build.controller.js'

const router = Router()

router.post('/api/builds', authMiddleware, triggerBuildHandler)
router.get('/api/builds/:buildId', authMiddleware, getBuildStatusHandler)
router.get('/api/builds/page/:pageId', authMiddleware, listBuildsHandler)

export default router
