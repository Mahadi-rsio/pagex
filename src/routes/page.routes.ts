import { Router } from 'express'
import { createPageHandler, getUsageHandler } from '../controllers/page.controller.js'
import { authMiddleware } from '../middleware/auth.middleware.js'

const router = Router()

router.post('/api/pages/create', authMiddleware, createPageHandler)
router.get('/api/pages/usage/:domain', authMiddleware, getUsageHandler)

export default router
