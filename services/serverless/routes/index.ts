import { Hono } from 'hono'
import pageRouter from './page.routes.js'
import deploymentRouter from './deployment.routes.js'
import deployRouter from './deploy.routes.js'
import usageRouter from './usage.routes.js'

const router = new Hono()

router.get('/health', (c) => {
    return c.json({
        message: "ok",
    })
})

//for testing
router.get('/v1/check-domain', (c) => {
    const domain = c.req.query('domain')

    if (typeof domain === 'string' && domain.endsWith('.cloudisy.top')) {
        console.log(`✅ TLS allowed for: ${domain}`)
        return c.text('OK', 200)
    }

    console.log(`❌ TLS denied or invalid input: ${domain}`)
    return c.text('Forbidden', 403)
})

router.route('/', pageRouter)
router.route('/', deployRouter)
router.route('/', deploymentRouter)
router.route('/', usageRouter)

export default router