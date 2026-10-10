import { Redis } from "@upstash/redis";
import {
    activeDeploymentMappingKey,
    bandwidthKey,
    dbCacheKey,
    manifestRedisKey,
    redisKey,
    requestsKey,
    siteFilesKey,
    siteVersionKey,
    subdomainMappingKey,
} from "./config";

/**
 * Minimal Redis surface used by the worker. The console uses Upstash's REST
 * client; the worker talks to the same Upstash database over the same REST
 * protocol, so the key space is shared.
 */
export interface RedisClient {
    del(...keys: string[]): Promise<unknown>;
    pipeline(): unknown;
}

export function createRedisClient(env: Env): RedisClient | null {
    const url = env.UPSTASH_REDIS_REST_URL;
    const token = env.UPSTASH_REDIS_REST_TOKEN;
    if (!url || !token) return null;
    return new Redis({ url, token });
}

/**
 * Best-effort purge of a deleted project's cached routing/runtime state.
 *
 * The console already sweeps most of these keys synchronously during delete
 * (`services/console/src/features/projects/page.service.ts`); this is a
 * defensive re-sweep for anything that raced or was missed. Never throws:
 * PostgreSQL and R2 remain authoritative.
 */
export async function purgeDeletedPageCache(
    client: RedisClient | null,
    prefix: string,
    input: {
        siteId: string;
        subdomain: string;
        domain: string;
        deploymentIds: readonly string[];
    },
): Promise<void> {
    if (!client) return;
    const keys = [
        subdomainMappingKey(input.subdomain),
        activeDeploymentMappingKey(input.siteId),
        siteFilesKey(input.siteId),
        siteVersionKey(input.siteId),
        dbCacheKey(input.domain),
        requestsKey(input.domain),
        bandwidthKey(input.domain),
        ...input.deploymentIds.map((id) => manifestRedisKey(id)),
    ].map((key) => redisKey(prefix, key));

    try {
        await client.del(...keys);
    } catch (err) {
        console.error(
            `[cleanup] redis cache purge failed for site ${input.siteId}; PostgreSQL remains authoritative`,
            err,
        );
    }
}
