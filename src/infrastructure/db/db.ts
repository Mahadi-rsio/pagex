import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import "dotenv/config"


const pool = new Pool({
    connectionString: process.env.DB
})

export const db = drizzle(pool)
