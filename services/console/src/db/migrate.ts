import path from "node:path";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { db } from "./index";

const MIGRATIONS_DIR = path.join(process.cwd(), "drizzle");

export async function runMigrations() {
    console.log("[migrate] Running console database migrations...");
    await migrate(db, {
        migrationsFolder: MIGRATIONS_DIR,
        migrationsTable: "__drizzle_migrations_console",
        migrationsSchema: "drizzle",
    });
    console.log("[migrate] Migrations complete.");
}
