import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import "dotenv/config";

const connectionString = process.env.DB!;

export const dbClient = postgres(connectionString, {
    // CRITICAL for transaction mode: disable prepared statements
    prepare: false,
    max: 10,
    idle_timeout: 20,
    max_lifetime: 1800,
});

export const db = drizzle(dbClient);
