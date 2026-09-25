import type { MiddlewareHandler } from 'hono'
import { createRemoteJWKSet, jwtVerify } from 'jose'
import type { AppEnv } from '../types.js'

/**
 * JWKS from next-web Better Auth.
 * Compose sets AUTH_JWKS_URL=http://next_web:3000/api/auth/jwks (in-network).
 * Host / local default: console on :3001.
 */
const JWKS_URL = process.env.AUTH_JWKS_URL || 'http://localhost:3001/api/auth/jwks'
const JWKS = createRemoteJWKSet(new URL(JWKS_URL))

export const authMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
    const authHeader = c.req.header('authorization')

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return c.json({ error: 'Missing or invalid authorization header' }, 401)
    }

    const token = authHeader.split(' ')[1]

    try {
        const { payload } = await jwtVerify(token!, JWKS)
        if (typeof payload.id === 'string') c.set('id', payload.id)
        if (typeof payload.name === 'string') c.set('name', payload.name)

        await next()
    } catch (err) {
        console.error('Token verification failed:', err)
        return c.json({ error: 'Invalid or expired token' }, 401)
    }
}