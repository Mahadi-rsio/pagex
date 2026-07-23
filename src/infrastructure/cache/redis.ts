import 'dotenv/config'

import { Redis } from "ioredis"

export const connection = {
    host: "redis",
    port: 6379,
    // BullMQ — Redis DB2
    db: 2,
}

/** Default Redis client (DB0) — rate limiting, misc. */
export const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379")

/**
 * Usage / deploy-token Redis (DB3).
 * Keys: deploy:token:*, requests:*, bandwidth:*, db_cache:*, site:* invalidation helpers.
 */
export const usageRedis = new Redis(process.env.REDIS_URL || "redis://localhost:6379", {
    db: 3,
})
