import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

config({ path: ".env" });

export default defineConfig({
    schema: "./src/modules/api/schemas/api.schema.ts",
    out: "./drizzle-api",
    dialect: "postgresql",
    migrations: {
        table: "__drizzle_migrations",
        schema: "drizzle",
    },
    dbCredentials: {
        url: process.env.DATABASE_URL!,
    },
});
