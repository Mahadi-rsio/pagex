import Redis from "ioredis";

const globalForRedis = globalThis as unknown as {
    redis?: Redis;
};

export const redis =
    globalForRedis.redis ??
    new Redis(process.env.REDIS_URL || "redis://localhost:6379", {
        maxRetriesPerRequest: 1,
        lazyConnect: true,
    });

redis.on("error", () => {});

if (process.env.NODE_ENV !== "production") {
    globalForRedis.redis = redis;
}

export async function ensureRedis() {
    if (redis.status === "wait") {
        await redis.connect();
    }
}

export async function checkRedisConnection() {
    await ensureRedis();
    await redis.ping();
}
