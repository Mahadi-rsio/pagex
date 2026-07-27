import { defineConfig } from 'drizzle-kit'
import 'dotenv/config'

export default defineConfig({
    schema: "./src/infrastructure/db/schema.ts",
    dialect: "postgresql",
    out: "./drizzle",
    dbCredentials: {
        url: process.env.DRIZZLE_CONNECTION!
    }
})
