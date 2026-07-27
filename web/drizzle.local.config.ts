import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

config({ path: ".env" });

export default defineConfig({
    schema: "./src/db/schema.ts",
    out: "./src/drizzle",
    dialect: "postgresql",
    dbCredentials: {
        url:
            process.env.DATABASE_URL ||
            "postgres://postgres:postgres@localhost:5432/next_web",
    },
});
