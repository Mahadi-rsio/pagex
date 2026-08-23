import { defineConfig } from 'drizzle-kit'
import 'dotenv/config'

export default defineConfig({
    schema: "./infrastructure/db/schema.ts",
    dialect: "postgresql",
    out: "./drizzle",
    migrations: {
        table: "__drizzle_migrations",
        schema: "drizzle",
    },
    dbCredentials: {
        url: process.env.DRIZZLE_CONNECTION!
    }
})
