import { Redis } from "@upstash/redis";

/**
 * Upstash Redis exposes a single logical database, so the previous split between
 * `db0` (cache) and `db3` (deploy tokens / page locks) is expressed with a
 * platform-wide key prefix instead. The two namespaces were disjoint, so
 * prefixing is collision-free.
 */
const KEY_PREFIX = process.env.REDIS_KEY_PREFIX ?? "px";

function requiredEnv(name: string): string {
    const value = process.env[name];
    if (!value) throw new Error(`${name} environment variable is required`);
    return value;
}

let cached: Redis | null = null;

function createRedis(): Redis {
    return new Redis({
        url: requiredEnv("UPSTASH_REDIS_REST_URL"),
        token: requiredEnv("UPSTASH_REDIS_REST_TOKEN"),
        // Values are stored as JSON strings, so deserialise on read to keep the
        // shapes the feature services expect (objects, numbers, null).
        automaticDeserialization: true,
    });
}

export function getRedis(): Redis {
    cached ??= createRedis();
    return cached;
}

/**
 * The shared Upstash client. Keys are namespaced through `redisKey` on every
 * call, which keeps deploy tokens and page locks isolated from cache entries
 * without depending on Redis logical databases.
 */
export const redis = new Proxy({} as Redis, {
    get(_target, prop) {
        const client = getRedis() as unknown as Record<
            string | symbol,
            unknown
        >;
        const value = client[prop];
        return typeof value === "function" ? value.bind(client) : value;
    },
});

/** Apply the platform-wide key prefix to a logical key name. */
export function redisKey(key: string): string {
    return `${KEY_PREFIX}:${key}`;
}

export async function checkRedisConnection() {
    await getRedis().ping();
}
