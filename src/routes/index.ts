import { Router } from 'express'
import pageRouter from './page.routes.js'
import uploadRouter from './upload.routes.js'
import buildRouter from './build.routes.js'
import { authMiddleware } from './../middleware/auth.middleware.js'

const router = Router()

router.get('/health', (req, res) => {
    res.json({
        message: "ok",
    })
})


//for testing
router.get('/v1/check-domain', (req, res) => {
    const { domain } = req.query;

    if (typeof domain === 'string' && domain.endsWith('.cloudisy.top')) {
        console.log(`✅ TLS allowed for: ${domain}`);
        return res.status(200).send('OK');
    }

    console.log(`❌ TLS denied or invalid input: ${domain}`);
    return res.status(403).send('Forbidden');
});

router.use(pageRouter)
router.use('/upload', uploadRouter)
router.use(buildRouter)

export default router
