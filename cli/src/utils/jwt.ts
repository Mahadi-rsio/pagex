import { authClient } from '../auth/deviceAuth.js'
import { getToken } from './session.js'
import { AuthError } from './errors.js'

interface CachedToken {
    token: string
    expiresAt: number // Unix ms
}

let cache: CachedToken | null = null

const TOKEN_TTL_MS = 25 * 60 * 1000 // 25 min (5 min buffer before 30 min expiry)

export async function jwtToken(): Promise<string> {
    const now = Date.now()

    // Return cached token if still valid
    if (cache && now < cache.expiresAt) {
        return cache.token
    }

    const token = getToken()
    if (!token) {
        throw new AuthError('You are not logged in. Please run `pagex login`.')
    }

    // Fetch a fresh token
    const { data } = await authClient.token({
        fetchOptions: {
            headers: {
                Authorization: `Bearer ${token}`
            }
        }
    })

    if (!data?.token) {
        throw new AuthError('Could not refresh your session. Please run `pagex login`.')
    }

    // Cache it
    cache = {
        token: data.token,
        expiresAt: now + TOKEN_TTL_MS
    }

    return cache.token
}

/** Call this on logout to clear the cached token */
export function clearJwtCache(): void {
    cache = null
}
