import 'dotenv/config'
import { Redis } from 'ioredis'

/**
 * Inside Compose services set IN_DOCKER_COMPOSE=1 and use hostname `redis`.
 * Host / Codespace processes remap `redis` → localhost (port 6379 published).
 */
function resolveRedisUrl(): string {
    const raw = process.env.REDIS_URL || 'redis://localhost:6379'
    if (process.env.IN_DOCKER_COMPOSE === '1') return raw

    try {
        const url = new URL(raw)
        if (url.hostname === 'redis') {
            url.hostname = 'localhost'
            return url.toString()
        }
    } catch {
        // keep raw
    }
    return raw
}

const REDIS_URL = resolveRedisUrl()

function connectionFromUrl(db: number) {
    const url = new URL(REDIS_URL)
    return {
        host: url.hostname,
        port: Number(url.port || 6379),
        db,
        ...(url.password ? { password: decodeURIComponent(url.password) } : {}),
    }
}

/** BullMQ — Redis DB2 (derived from REDIS_URL host/port). */
export const connection = connectionFromUrl(2)

function attachErrorHandler(client: Redis, label: string): Redis {
    client.on('error', (err: Error) => {
        console.error(`[redis:${label}]`, err.message)
    })
    return client
}

/** Default Redis client (DB0) — rate limiting, site:{subdomain}, site_files:{siteId}. */
export const redis = attachErrorHandler(new Redis(REDIS_URL), 'db0')

/**
 * Usage / deploy-token Redis (DB3).
 * Keys: deploy:token:*, requests:*, bandwidth:*, db_cache:*.
 */
export const usageRedis = attachErrorHandler(new Redis(REDIS_URL, { db: 3 }), 'db3')
