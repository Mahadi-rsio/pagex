import path from "node:path";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { bootstrapApiMigrations } from "../server/api/infrastructure/db/bootstrap-migrations";
import { db } from "./index";

const migrationSets = [
    {
        name: "auth",
        folder: path.join(process.cwd(), "drizzle"),
        table: "__drizzle_migrations_console",
    },
    {
        name: "api",
        folder: path.join(process.cwd(), "drizzle-api"),
        table: "__drizzle_migrations",
    },
] as const;

export async function runMigrations() {
    for (const migrationSet of migrationSets) {
        console.log(`[migrate] Running ${migrationSet.name} migrations...`);
        if (migrationSet.name === "api") {
            await bootstrapApiMigrations(
                migrationSet.folder,
                migrationSet.table,
            );
        }
        await migrate(db, {
            migrationsFolder: migrationSet.folder,
            migrationsTable: migrationSet.table,
            migrationsSchema: "drizzle",
        });
    }
    console.log("[migrate] Migrations complete.");
}
