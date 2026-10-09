import { getCloudflareContext } from "@opennextjs/cloudflare";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

export type Database = NodePgDatabase<typeof schema>;

const globalForDb = globalThis as unknown as {
    pool?: Pool;
    poolConnectionString?: string;
};

function resolveConnectionString(): string {
    try {
        const { env } = getCloudflareContext();
        const hyperdrive = (env as CloudflareEnv | undefined)?.HYPERDRIVE;
        if (hyperdrive?.connectionString) {
            return hyperdrive.connectionString;
        }
    } catch {
        // Outside a Workers request (migrate scripts, plain Node tooling).
    }

    const url = process.env.DATABASE_URL;
    if (!url) {
        throw new Error("DATABASE_URL environment variable is required");
    }
    return url;
}

function createPool(connectionString: string): Pool {
    // Hyperdrive owns the origin pool — keep the Worker-side pool small.
    // Do not set `prepare: false`; Hyperdrive docs warn that disabling
    // prepared statements can cause hangs under transaction pooling.
    // `maxUses: 1` avoids reusing a TCP socket across isolated requests
    // (OpenNext Hyperdrive guidance).
    const pool = new Pool({
        connectionString,
        max: Number(process.env.DATABASE_POOL_MAX ?? 5),
        maxUses: 1,
    });
    // pg-pool has no default error listener: an idle-client socket error would
    // otherwise be rethrown through EventEmitter and surface as an
    // unhandledRejection. With `maxUses: 1` every connection is closed right
    // after its query, which races with pg-cloudflare's read loop
    // (`CloudflareSocket._listen`) and rejects with this expected teardown
    // error — ignore it, but keep logging any real idle-connection failure.
    pool.on("error", (err) => {
        if (
            err instanceof Error &&
            err.message === "This socket has been closed."
        ) {
            return;
        }
        console.error("postgres pool error", err);
    });
    return pool;
}

export function getPool(): Pool {
    const connectionString = resolveConnectionString();
    if (
        globalForDb.pool &&
        globalForDb.poolConnectionString === connectionString
    ) {
        return globalForDb.pool;
    }

    const pool = createPool(connectionString);
    globalForDb.pool = pool;
    globalForDb.poolConnectionString = connectionString;
    return pool;
}

let database: Database | undefined;

function getDatabase(): Database {
    return (database ??= drizzle(getPool(), { schema }));
}

/**
 * Lazily-initialised node-postgres pool (Hyperdrive in Workers, DATABASE_URL locally).
 */
export const dbClient: Pool = new Proxy({} as Pool, {
    get(_target, prop) {
        const pool = getPool();
        const value = (pool as unknown as Record<string | symbol, unknown>)[
            prop
        ];
        return typeof value === "function" ? value.bind(pool) : value;
    },
});

/** Lazily-initialised Drizzle query builder bound to the shared schema. */
export const db: Database = new Proxy({} as Database, {
    get(_target, prop) {
        const instance = getDatabase();
        const value = (instance as unknown as Record<string | symbol, unknown>)[
            prop
        ];
        return typeof value === "function" ? value.bind(instance) : value;
    },
});

export async function getDb(): Promise<Database> {
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
