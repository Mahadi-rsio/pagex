import { Hono } from 'hono'
import { authMiddleware } from '../middleware/auth.middleware.js'
import {
    commitDeployHandler,
    prepareDeployHandler,
    presignDeployHandler,
} from '../controllers/deploy.controller.js'

const router = new Hono()

router.post('/api/deploy/prepare', authMiddleware, prepareDeployHandler)
router.post('/api/deploy/presign', authMiddleware, presignDeployHandler)

/**
 * Commit can expand Brotli/Gzip/WebP variants — allow up to 5 minutes.
 * On AWS Lambda the execution timeout is enforced by the Lambda / Function URL
 * configuration (COMMIT_TIMEOUT_MS in constants) rather than a request timer.
 */
router.post('/api/deploy/commit', authMiddleware, commitDeployHandler)

export default router