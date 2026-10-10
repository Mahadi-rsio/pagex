import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

export type Database = NodePgDatabase<typeof schema>;

const globalForDb = globalThis as unknown as {
    pool?: Pool;
    poolConnectionString?: string;
};

function resolveConnectionString(env: Env): string {
    if (env.HYPERDRIVE?.connectionString) {
        return env.HYPERDRIVE.connectionString;
    }
    const url = env.DATABASE_URL;
    if (!url) {
        throw new Error(
            "No database connection string: HYPERDRIVE binding or DATABASE_URL env is required",
        );
    }
    return url;
}

function createPool(connectionString: string): Pool {
    // Hyperdrive owns the origin pool — keep the Worker-side pool small.
    // Do not set `prepare: false`; Hyperdrive docs warn that disabling
    // prepared statements can cause hangs under transaction pooling.
    // `maxUses: 1` avoids reusing a TCP socket across isolated requests.
    const pool = new Pool({
        connectionString,
        max: 5,
        maxUses: 1,
    });
    // pg-pool has no default error listener: an idle-client socket error would
    // otherwise be rethrown through EventEmitter and surface as an
    // unhandledRejection. `maxUses: 1` races with pg-cloudflare's read loop
    // and rejects with this expected teardown error — ignore it, but keep
    // logging any real idle-connection failure.
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

export function getPool(env: Env): Pool {
    const connectionString = resolveConnectionString(env);
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

/** Lazily-initialised Drizzle query builder bound to the shared schema. */
export function getDb(env: Env): Database {
    return (database ??= drizzle(getPool(env), { schema }));
}
