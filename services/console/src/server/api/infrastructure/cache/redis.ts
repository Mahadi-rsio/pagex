import { Redis } from "ioredis";

function resolveRedisUrl(): string {
    const raw = process.env.REDIS_URL || "redis://localhost:6379";
    if (process.env.IN_DOCKER_COMPOSE === "1") return raw;

    try {
        const url = new URL(raw);
        if (url.hostname === "redis") {
            url.hostname = "localhost";
            return url.toString();
        }
    } catch {}

    return raw;
}

function attachErrorHandler(client: Redis, label: string): Redis {
    client.on("error", (error) => {
        console.error(`[redis:${label}]`, error.message);
    });
    return client;
}

const globalForApiRedis = globalThis as unknown as {
    apiRedis?: Redis;
    usageRedis?: Redis;
};

const redisUrl = resolveRedisUrl();
const redisOptions = {
    maxRetriesPerRequest: 1,
    lazyConnect: true,
} as const;

export const redis =
    globalForApiRedis.apiRedis ??
    attachErrorHandler(new Redis(redisUrl, redisOptions), "db0");

export const usageRedis =
    globalForApiRedis.usageRedis ??
    attachErrorHandler(new Redis(redisUrl, { ...redisOptions, db: 3 }), "db3");

if (process.env.NODE_ENV !== "production") {
    globalForApiRedis.apiRedis = redis;
    globalForApiRedis.usageRedis = usageRedis;
}
