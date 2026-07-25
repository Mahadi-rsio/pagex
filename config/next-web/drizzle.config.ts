import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

config({ path: ".env" });

/**
 * Auth (next-web / Better Auth) migrations only.
 * Uses a dedicated migrations table so Cloudisy’s `__drizzle_migrations` is untouched.
 */
export default defineConfig({
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
  migrations: {
    table: "next_web_drizzle_migrations",
  },
});
