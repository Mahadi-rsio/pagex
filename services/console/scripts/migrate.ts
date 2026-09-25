import { dbClient } from "../src/db";
import { runMigrations } from "../src/db/migrate";

async function main() {
    try {
        await runMigrations();
    } finally {
        await dbClient.end();
    }
}

main().catch((error: unknown) => {
    console.error(
        "[migrate] FATAL: Migration failed —",
        error instanceof Error ? error.message : error,
    );
    process.exitCode = 1;
});
