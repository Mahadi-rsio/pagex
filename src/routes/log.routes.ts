import { Router } from 'express'
import { internalLogHandler } from '../controllers/log.controller.js'

const router = Router()

router.post('/internal/log', internalLogHandler)

export default router
