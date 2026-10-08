// auth-config.ts — CLI generate only; not used at runtime
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import {
    bearer,
    jwt,
    deviceAuthorization,
    openAPI,
} from "better-auth/plugins";
import { nextCookies } from "better-auth/next-js";
import * as schema from "@/modules/auth/schemas/auth.schema";

// CLI placeholder values for schema generation
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
        bearer(),
        openAPI(),
        jwt({
            jwt: {
                expirationTime: "15m",
                definePayload({ user }) {
                    return { id: user.id };
                },
            },
        }),
        deviceAuthorization({ schema: {} }),
        nextCookies(),
    ],
});
