import { Router } from 'express'
import pageRouter from './page.routes.js'
import uploadRouter from './upload.routes.js'
import logRouter from './log.routes.js'

const router = Router()

router.get('/', (_, res) => { res.json({ message: "hello" }) })
router.use(pageRouter)
router.use('/upload', uploadRouter)
router.use(logRouter)

export default router
