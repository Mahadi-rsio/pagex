import { Router } from 'express'
import { authMiddleware } from '../middleware/auth.middleware.js'
import {
    commitDeployHandler,
    prepareDeployHandler,
    presignDeployHandler,
} from '../controllers/deploy.controller.js'

const router = Router()

router.post('/api/deploy/prepare', authMiddleware, prepareDeployHandler)
router.post('/api/deploy/presign', authMiddleware, presignDeployHandler)
router.post('/api/deploy/commit', authMiddleware, commitDeployHandler)

export default router
