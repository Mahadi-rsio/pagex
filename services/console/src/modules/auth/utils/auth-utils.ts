/** biome-ignore-all lint/style/noNonNullAssertion: <we will make sure it's not null> */
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { headers } from "next/headers";
import { getDb } from "@/db";
import { ensureRedis, redis } from "@/lib/redis";
import * as schema from "@/modules/auth/schemas/auth.schema";

import {
    openAPI,
    bearer,
    jwt,
    deviceAuthorization,
    emailOTP,
    phoneNumber,
} from "better-auth/plugins";
import { sendEmail, getOtpEmailHtml } from "./email";

const redisSecondaryStorage = {
    get: async (key: string) => {
        await ensureRedis();
        return await redis.get(key);
    },
    set: async (key: string, value: string, ttl?: number) => {
        await ensureRedis();
        if (ttl) {
            await redis.set(key, value, "EX", ttl);
        } else {
            await redis.set(key, value);
        }
    },
    delete: async (key: string) => {
        await ensureRedis();
        await redis.del(key);
    },
};

async function sendOtpPhone({
    phone,
    otp,
    token,
}: {
    phone: string;
    otp: string;
    token: string;
}) {
    const response = await fetch("https://dnotify.net/api/v1/send-sms", {
        method: "POST",
        headers: {
            Authorization: "Bearer " + token,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            mobile: phone,
            message: `Your Otp is ${otp}.Dont Share this otp to anyone.`,
        }),
    });

    const data = await response.json();
    console.log(data);
}

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
            nextCookies(),
            bearer(),
            openAPI(),
            phoneNumber({
                sendOTP: async ({ phoneNumber, code }) => {
                    if (!process.env.SMS_TOKEN) return;
                    await sendOtpPhone({
                        phone: phoneNumber,
                        otp: code,
                        token: process.env.SMS_TOKEN,
                    });
                },
            }),
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
            emailOTP({
                async sendVerificationOTP({ email, otp, type }) {
                    if (type === "email-verification") {
                        const smtpHost = process.env.SMTP_HOST;
                        const smtpPort = process.env.SMTP_PORT;
                        const sender = process.env.SENDER;
                        const smtpPassword = process.env.BREVO_API_KEY;

                        if (
                            !smtpHost ||
                            !smtpPort ||
                            !sender ||
                            !smtpPassword
                        ) {
                            return;
                        }

                        await sendEmail(
                            {
                                to: email,
                                from: '"Cloudisy" <team@cloudisy.com>',
                                subject: "Verify Your Email",
                                text: "Your Otp is " + otp,
                                html: getOtpEmailHtml(otp),
                            },
                            {
                                host: smtpHost,
                                port: Number(smtpPort),
                                user: sender,
                                pass: smtpPassword,
                            },
                        );
                    }
                },
            }),
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
