export async function register() {
    // Only run in the Node.js server runtime — skip Edge and production builds.
    if (process.env.NEXT_RUNTIME !== "nodejs") return;
    if (process.env.NEXT_PHASE === "phase-production-build") return;
    if (!process.env.DATABASE_URL) {
        console.warn("[migrate] Skipping — DATABASE_URL not set");
        return;
    }

    const { runMigrations } = await import("./db/migrate");
    try {
        await runMigrations();
    } catch (err) {
        console.error(
            "[migrate] FATAL: Migration failed —",
            (err as Error).message,
        );
        process.exit(1);
    }
}
