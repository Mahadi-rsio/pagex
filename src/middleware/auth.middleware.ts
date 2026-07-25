import type { Request, Response, NextFunction } from 'express'
import { createRemoteJWKSet, jwtVerify } from 'jose'

/**
 * JWKS from next-web Better Auth.
 * Compose sets AUTH_JWKS_URL=http://next_web:3000/api/auth/jwks (in-network).
 * Host / local default: console Caddy on :3080.
 */
const JWKS_URL = process.env.AUTH_JWKS_URL || 'http://localhost:3080/api/auth/jwks'
const JWKS = createRemoteJWKSet(new URL(JWKS_URL))

export async function authMiddleware(req: Request, res: Response, next: NextFunction) {
    const authHeader = req.headers.authorization

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Missing or invalid authorization header' })
    }

    const token = authHeader.split(' ')[1]

    try {
        const { payload } = await jwtVerify(token!, JWKS)
            ; (req as any).id = payload.id
            ; (req as any).name = payload.name

        next()
    } catch (err) {
        console.error('Token verification failed:', err)
        return res.status(401).json({ error: 'Invalid or expired token' })
    }
}
