import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const globalForDb = globalThis as unknown as {
    client?: postgres.Sql;
};

const client =
    globalForDb.client ??
    postgres(process.env.DATABASE_URL!, {
        prepare: false, // ← required for PgBouncer transaction mode
    });

if (process.env.NODE_ENV !== "production") {
    globalForDb.client = client;
}

export const db = drizzle(client, { schema });

export async function getDb() {
    return db;
}

export async function checkDatabaseConnection() {
    await client`SELECT 1`;
}

export * from "./schema";
