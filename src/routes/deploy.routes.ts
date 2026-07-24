import { Router } from 'express'
import { authMiddleware } from '../middleware/auth.middleware.js'
import { COMMIT_TIMEOUT_MS } from '../constants/index.js'
import {
    commitDeployHandler,
    prepareDeployHandler,
    presignDeployHandler,
} from '../controllers/deploy.controller.js'

const router = Router()

router.post('/api/deploy/prepare', authMiddleware, prepareDeployHandler)
router.post('/api/deploy/presign', authMiddleware, presignDeployHandler)

/** Commit can expand Brotli/Gzip/WebP variants — allow up to 5 minutes. */
router.post(
    '/api/deploy/commit',
    authMiddleware,
    (req, res, next) => {
        req.setTimeout(COMMIT_TIMEOUT_MS)
        res.setTimeout(COMMIT_TIMEOUT_MS)
        next()
    },
    commitDeployHandler
)

export default router
