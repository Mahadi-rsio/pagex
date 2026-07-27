/** biome-ignore-all lint/style/noNonNullAssertion: Ignore for this file */

import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

config({ path: ".env" });

export default defineConfig({
    schema: "./src/db/schema.ts",
    out: "./drizzle",
    dialect: "postgresql",
    // Separate from API's drizzle.__drizzle_migrations — both apps share one DB,
    // and drizzle-kit only applies migrations newer than the latest created_at.
    migrations: {
        table: "__drizzle_migrations_console",
        schema: "drizzle",
    },
    dbCredentials: {
        url: process.env.DATABASE_URL!,
    },
});
