import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

type Database = PostgresJsDatabase<typeof schema>;

const globalForDb = globalThis as unknown as {
    client?: postgres.Sql;
};

function createClient(): postgres.Sql {
    const url = process.env.DATABASE_URL;
    if (!url) {
        throw new Error("DATABASE_URL environment variable is required");
    }

    const client = postgres(url, {
        // Neon exposes a PgBouncer-compatible pooled endpoint, which does not
        // support prepared statements. `DATABASE_URL` should point at that
        // pooled host; run migrations against Neon's direct (unpooled) endpoint
        // by overriding DATABASE_URL for that single `pnpm db:migrate` run if
        // the pooled endpoint ever blocks on the DDL lock.
        prepare: false,
        // Serverless functions are short-lived, so keep the pool small and
        // recycle idle connections rather than holding them open.
        max: Number(process.env.DATABASE_POOL_MAX ?? 5),
        idle_timeout: 20,
        connect_timeout: 10,
    });

    if (process.env.NODE_ENV !== "production") {
        globalForDb.client = client;
    }

    return client;
}

/**
 * Connection is created on first use rather than at import time so that module
 * evaluation stays side-effect free. `next build` imports this module while
 * collecting page data, where no database is reachable.
 */
function getClient(): postgres.Sql {
    return (globalForDb.client ??= createClient());
}

/** Lazily-initialised postgres-js client, also used as a tagged template. */
export const dbClient = new Proxy({} as postgres.Sql, {
    get(_target, prop) {
        const client = getClient() as unknown as Record<
            string | symbol,
            unknown
        >;
        const value = client[prop];
        return typeof value === "function" ? value.bind(client) : value;
    },
    apply(_target, thisArg, argArray) {
        const client = getClient() as unknown as (
            ...args: unknown[]
        ) => unknown;
        return Reflect.apply(client, thisArg, argArray);
    },
});

let database: Database | null = null;

/** Lazily-initialised Drizzle query builder bound to the shared schema. */
export const db: Database = new Proxy({} as Database, {
    get(_target, prop) {
        database ??= drizzle(getClient(), { schema });
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
    await getClient()`SELECT 1`;
}

export * from "./schema";
