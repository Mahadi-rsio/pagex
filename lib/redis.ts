// lib/redis.ts
import { Redis } from "ioredis"

export const connection = {
    host: "redis",
    port: 6379
}

export const redis = new Redis(process.env.REDIS_URL || "redis://redis:6379")
