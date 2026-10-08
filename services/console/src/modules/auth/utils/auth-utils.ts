/** biome-ignore-all lint/style/noNonNullAssertion: <we will make sure it's not null> */
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { bearer, deviceAuthorization, jwt, openAPI } from "better-auth/plugins";
import { headers } from "next/headers";
import { getDb } from "@/db";
import * as schema from "@/modules/auth/schemas/auth.schema";
import { redis, redisKey } from "@/server/api/infrastructure/cache/redis";

/** Atomic INCR with TTL set only on first create (rate-limit windows). */
const INCREMENT_SCRIPT = `
local value = redis.call("INCR", KEYS[1])
if value == 1 then
  redis.call("EXPIRE", KEYS[1], ARGV[1])
end
return value
`;

const redisSecondaryStorage = {
    get: async (key: string) => {
        return await redis.get<string>(redisKey(key));
    },
    getAndDelete: async (key: string) => {
        return await redis.getdel<string>(redisKey(key));
    },
    increment: async (key: string, ttl: number) => {
        const value = await redis.eval<[string], number>(
            INCREMENT_SCRIPT,
            [redisKey(key)],
            [String(ttl)],
        );
        return Number(value);
    },
    set: async (key: string, value: string, ttl?: number) => {
        if (ttl) {
            await redis.set(redisKey(key), value, { ex: ttl });
        } else {
            await redis.set(redisKey(key), value);
        }
    },
    delete: async (key: string) => {
        await redis.del(redisKey(key));
    },
};

async function getAuth() {
    const db = await getDb();

    return betterAuth({
        secret: process.env.BETTER_AUTH_SECRET!,
        baseURL: process.env.BETTER_AUTH_URL!,
        trustedOrigins: [
            ...(process.env.BETTER_AUTH_TRUSTED_ORIGINS || "")
                .split(",")
                .map((origin) => origin.trim())
                .filter(Boolean),
            "http://localhost:3000",
            "http://localhost:5173",
            "http://127.0.0.1:3000",
            "http://127.0.0.1:5173",
            "https://auth.cloudisy.com",
        ],
        database: drizzleAdapter(db, {
            provider: "pg",
            schema,
        }),
        // Sessions, rate limits, and short-lived auth data go to Redis.
        secondaryStorage: redisSecondaryStorage,
        emailAndPassword: {
            // Password + OAuth only. Email delivery and phone OTP are disabled —
            // there is no email or SMS provider in this deployment.
            enabled: process.env.ENABLE_EMAIL_PASSWORD !== "false",
        },
        socialProviders: {
            github: {
                enabled: true,
                clientId: process.env.GITHUB_CLIENT_ID!,
                clientSecret: process.env.GITHUB_CLIENT_SECRET!,
            },
            google: {
                enabled: true,
                clientId: process.env.GOOGLE_CLIENT_ID!,
                clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
            },
        },
        plugins: [
            bearer(),
            openAPI(),
            jwt({
                jwt: {
                    expirationTime: "20m",
                    definePayload({ user }) {
                        return {
                            id: user.id,
                            name: user.name,
                        };
                    },
                },
            }),
            deviceAuthorization({
                schema: {},
            }),
            nextCookies(),
        ],
    });
}

export async function getAuthInstance() {
    return await getAuth();
}

/**
 * Get session information
 */
export async function getSession() {
    try {
        const auth = await getAuth();
        return await auth.api.getSession({
            headers: await headers(),
        });
    } catch (error) {
        console.error("Error getting session:", error);
        return null;
    }
}
