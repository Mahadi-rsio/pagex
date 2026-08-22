import { randomUUID } from 'node:crypto'
import { usageRedis } from '../infrastructure/cache/redis.js'
import {
    DEPLOY_LOCK_COMMIT_TTL_SECONDS,
    DEPLOY_LOCK_HEARTBEAT_MS,
} from '../constants/index.js'
import { HttpError } from '../utils/http-error.js'

export const DEPLOYMENT_IN_PROGRESS_MESSAGE =
    'A deployment is already in progress for this page'

export const DEPLOYMENT_LOCK_LOST_MESSAGE =
    'Lost deployment lock before activation; aborting to avoid overwriting a concurrent deploy'

export const STALE_DEPLOYMENT_MESSAGE =
    'A newer deployment already exists; this deploy is stale and will not be activated'

/** Redis key for the per-page exclusive deployment lock (DB3). */
export function deploymentLockKey(pageId: string): string {
    return `deploy:lock:${pageId}`
}

/**
 * SET NX the lock, or refresh TTL if this holder already owns it (re-entrant).
 * Returns 1 if acquired/refreshed, 0 if another holder owns the lock.
 */
export const ACQUIRE_LOCK_LUA = `
-- acquire
local current = redis.call('GET', KEYS[1])
local holder = ARGV[1]
local ttl = tonumber(ARGV[2])
if current == false then
  redis.call('SET', KEYS[1], holder, 'EX', ttl)
  return 1
end
if current == holder then
  redis.call('EXPIRE', KEYS[1], ttl)
  return 1
end
return 0
`

export const RELEASE_LOCK_LUA = `
-- release
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`

export const HELD_LOCK_LUA = `
-- held
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return 1
end
return 0
`

export type RedisEval = (
    script: string,
    numKeys: number,
    ...args: Array<string | number>
) => Promise<unknown>

export interface PageDeploymentLock {
    acquire(pageId: string, holderId: string, ttlSeconds: number): Promise<boolean>
    release(pageId: string, holderId: string): Promise<boolean>
    isHeldBy(pageId: string, holderId: string): Promise<boolean>
    assertHeld(pageId: string, holderId: string): Promise<void>
    withLock<T>(
        pageId: string,
        holderId: string,
        ttlSeconds: number,
        fn: () => Promise<T>,
    ): Promise<T>
}

function asFlag(result: unknown): boolean {
    return result === 1 || result === '1'
}

export function createPageDeploymentLock(evalFn: RedisEval): PageDeploymentLock {
    async function acquire(
        pageId: string,
        holderId: string,
        ttlSeconds: number,
    ): Promise<boolean> {
        const result = await evalFn(
            ACQUIRE_LOCK_LUA,
            1,
            deploymentLockKey(pageId),
            holderId,
            ttlSeconds,
        )
        return asFlag(result)
    }

    async function release(pageId: string, holderId: string): Promise<boolean> {
        const result = await evalFn(RELEASE_LOCK_LUA, 1, deploymentLockKey(pageId), holderId)
        return asFlag(result)
    }

    async function isHeldBy(pageId: string, holderId: string): Promise<boolean> {
        const result = await evalFn(HELD_LOCK_LUA, 1, deploymentLockKey(pageId), holderId)
        return asFlag(result)
    }

    async function assertHeld(pageId: string, holderId: string): Promise<void> {
        if (!(await isHeldBy(pageId, holderId))) {
            throw new HttpError(DEPLOYMENT_LOCK_LOST_MESSAGE, 409)
        }
    }

    async function withLock<T>(
        pageId: string,
        holderId: string,
        ttlSeconds: number,
        fn: () => Promise<T>,
    ): Promise<T> {
        const acquired = await acquire(pageId, holderId, ttlSeconds)
        if (!acquired) {
            throw new HttpError(DEPLOYMENT_IN_PROGRESS_MESSAGE, 409)
        }

        const heartbeat = setInterval(() => {
            void acquire(pageId, holderId, ttlSeconds).then((ok) => {
                if (!ok) {
                    console.error(
                        `[deploy-lock] heartbeat lost lock for page ${pageId} holder ${holderId}`,
                    )
                }
            })
        }, DEPLOY_LOCK_HEARTBEAT_MS)
        heartbeat.unref?.()

        try {
            return await fn()
        } finally {
            clearInterval(heartbeat)
            await release(pageId, holderId).catch((err: unknown) => {
                console.error('[deploy-lock] failed to release lock', err)
            })
        }
    }

    return { acquire, release, isHeldBy, assertHeld, withLock }
}

const usageRedisEval: RedisEval = (script, numKeys, ...args) =>
    usageRedis.eval(script, numKeys, ...args)

export const pageDeploymentLock = createPageDeploymentLock(usageRedisEval)

export function newLockHolder(prefix: string): string {
    return `${prefix}:${randomUUID()}`
}

export { DEPLOY_LOCK_COMMIT_TTL_SECONDS }
