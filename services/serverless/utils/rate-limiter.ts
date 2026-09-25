import type { MiddlewareHandler } from 'hono'
import { redis } from '../infrastructure/cache/redis.js'
import type { AppEnv } from '../types.js'

export interface RateLimiterConfig {
  windowMs: number
  max: number
}

export function createRateLimiter(config: RateLimiterConfig): MiddlewareHandler<AppEnv> {
  const windowSeconds = Math.ceil(config.windowMs / 1000)

  return async (c, next) => {
    const forwarded = c.req.header('x-forwarded-for')
    const ip = forwarded?.split(',')[0]?.trim() || 'unknown'
    const key = `rl:${ip}`

    const count = await redis.incr(key)
    if (count === 1) {
      await redis.expire(key, windowSeconds)
    }

    c.header('X-RateLimit-Limit', String(config.max))
    c.header('X-RateLimit-Remaining', String(Math.max(0, config.max - count)))

    if (count > config.max) {
      return c.json({ error: 'Too many requests' }, 429)
    }

    return next()
  }
}