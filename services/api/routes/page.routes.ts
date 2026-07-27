import { Router } from 'express'
import { createPageHandler, deletePageHandler, getListPagesHandler, getUsageHandler } from '../controllers/page.controller.js'
import { authMiddleware } from '../middleware/auth.middleware.js'

const router = Router()

router.post('/api/pages/create', authMiddleware, createPageHandler)
router.get('/api/pages/usage/:domain', authMiddleware, getUsageHandler)

router.get('/api/pages', authMiddleware, getListPagesHandler)
router.delete('/api/pages/:id', authMiddleware, deletePageHandler)

export default router
