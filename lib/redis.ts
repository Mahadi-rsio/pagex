// lib/redis.ts

import 'dotenv/config'

import { Redis } from "ioredis"

export const connection = {
    host: process.env.REDIS_URL || "redis://localhost:6379",
    port: 6379
}

export const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379")
