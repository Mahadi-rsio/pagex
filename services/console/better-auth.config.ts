// auth-config.ts — শুধু CLI generate-এর জন্য, runtime-এ ব্যবহার হবে না
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import {
    bearer,
    jwt,
    deviceAuthorization,
    emailOTP,
    phoneNumber,
    openAPI,
} from "better-auth/plugins";
import { nextCookies } from "better-auth/next-js";
import * as schema from "@/modules/auth/schemas/auth.schema";

// CLI-র জন্য dummy/placeholder values দিয়ে sync export
export const auth = betterAuth({
    secret: "placeholder",
    baseURL: "http://localhost:3000",
    database: drizzleAdapter({} as any, {
        provider: "pg",
        schema,
    }),
    emailAndPassword: {
        enabled: process.env.ENABLE_EMAIL_PASSWORD !== "false",
    },
    socialProviders: {
        github: {
            enabled: true,
            clientId: "placeholder",
            clientSecret: "placeholder",
        },
        google: {
            enabled: true,
            clientId: "placeholder",
            clientSecret: "placeholder",
        },
    },
    plugins: [
        nextCookies(),
        bearer(),
        openAPI(),
        phoneNumber({ sendOTP: async () => {} }),
        jwt({
            jwt: {
                expirationTime: "15m",
                definePayload({ user }) {
                    return { id: user.id };
                },
            },
        }),
        deviceAuthorization({ schema: {} }),
        emailOTP({ sendVerificationOTP: async () => {} }),
    ],
});
