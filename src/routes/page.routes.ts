import { Router } from 'express'
import { createPageHandler, getUsageHandler } from '../controllers/page.controller.js'

const router = Router()

router.post('/create_page', createPageHandler)
router.get('/api/usage/:domain', getUsageHandler)

export default router
