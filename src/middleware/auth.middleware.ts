import type { Request, Response, NextFunction } from 'express'
import { createRemoteJWKSet, jwtVerify } from 'jose'

const JWKS = createRemoteJWKSet(new URL('https://cloudisy.vercel.app/api/auth/jwks'))

export async function authMiddleware(req: Request, res: Response, next: NextFunction) {
    const authHeader = req.headers.authorization

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Missing or invalid authorization header' })
    }

    const token = authHeader.split(' ')[1]

    try {
        const { payload } = await jwtVerify(token, JWKS)
        req.user = payload
        next()
    } catch (err) {
        return res.status(401).json({ error: 'Invalid or expired token' })
    }
}
