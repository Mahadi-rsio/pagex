export async function register() {
    // Only run in the Node.js server runtime — skip Edge and production builds.
    if (process.env.NEXT_RUNTIME !== "nodejs") return;
    if (process.env.NEXT_PHASE === "phase-production-build") return;
    if (!process.env.DATABASE_URL) {
        console.warn("[migrate] Skipping — DATABASE_URL not set");
        return;
    }

    // On Vercel, `register` runs on every serverless cold start and many
    // instances can start at once, so applying migrations implicitly would add
    // latency to every invocation and race on the DDL lock. Set
    // RUN_STARTUP_TASKS=1 for the deploy that should apply them, or run
    // `pnpm db:migrate` against Neon out of band.
    if (process.env.VERCEL && process.env.RUN_STARTUP_TASKS !== "1") {
        return;
    }

    const { runMigrations } = await import("./db/migrate");
    try {
        await runMigrations();
        if (process.env.MINIO_BUCKET) {
            const { ensureSharedBucket } = await import(
                "./server/api/infrastructure/storage/minio"
            );
            await ensureSharedBucket();
        }
    } catch (err) {
        console.error(
            "[migrate] FATAL: Migration failed —",
            (err as Error).message,
        );
        throw err;
    }
}
