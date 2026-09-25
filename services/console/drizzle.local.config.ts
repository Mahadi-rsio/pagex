import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

config({ path: ".env" });

export default defineConfig({
    schema: "./src/modules/auth/schemas/auth.schema.ts",
    out: "./drizzle",
    dialect: "postgresql",
    migrations: {
        table: "__drizzle_migrations_console",
        schema: "drizzle",
    },
    dbCredentials: {
        url:
            process.env.DATABASE_URL ||
            "postgres://postgres:postgres@localhost:5432/next_web",
    },
});
