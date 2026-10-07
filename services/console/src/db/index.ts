import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import * as schema from "./schema";

const globalForDb = globalThis as unknown as {
    pool?: Pool;
};

function createPool(): Pool {
    const url = process.env.DATABASE_URL;
    if (!url) {
        throw new Error("DATABASE_URL environment variable is required");
    }

    const pool = new Pool({
        connectionString: url,
        max: Number(process.env.DATABASE_POOL_MAX ?? 5),
    });

    if (process.env.NODE_ENV !== "production") {
        globalForDb.pool = pool;
    }

    return pool;
}

export function getPool(): Pool {
    return (globalForDb.pool ??= createPool());
}

// biome-ignore lint/suspicious/noExplicitAny: Drizzle inferred type is too complex to write out here
let database: any;

function getDatabase() {
    return (database ??= drizzle(getPool(), { schema }));
}

/**
 * Lazily-initialised Neon pool client.
 */
export const dbClient = new Proxy({} as Pool, {
    get(_target, prop) {
        const pool = getPool();
        const value = (pool as unknown as Record<string | symbol, unknown>)[
            prop
        ];
        return typeof value === "function" ? value.bind(pool) : value;
    },
});

/** Lazily-initialised Drizzle query builder bound to the shared schema. */
// biome-ignore lint/suspicious/noExplicitAny: Proxy target
export const db: any = new Proxy({} as any, {
    get(_target, prop) {
        const database = getDatabase();
        const value = (database as unknown as Record<string | symbol, unknown>)[
            prop
        ];
        return typeof value === "function" ? value.bind(database) : value;
    },
});

export async function getDb() {
    return db;
}

export async function checkDatabaseConnection() {
    const client = await getPool().connect();
    try {
        await client.query("SELECT 1");
    } finally {
        client.release();
    }
}

export * from "./schema";
