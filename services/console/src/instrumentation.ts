/**
 * Next.js instrumentation hook.
 *
 * Cloudflare Workers cold starts must not run Drizzle migrations or provision
 * storage. Apply schema changes deliberately with `pnpm db:migrate` against an
 * explicitly selected development (or production) database.
 *
 * Set RUN_STARTUP_TASKS=1 only for a deliberate Node/admin process that should
 * apply pending migrations once. R2 buckets are created via Wrangler / the
 * Cloudflare dashboard — never from request-path startup.
 */
export async function register() {
    if (process.env.NEXT_RUNTIME !== "nodejs") return;
    if (process.env.NEXT_PHASE === "phase-production-build") return;
    if (process.env.RUN_STARTUP_TASKS !== "1") return;
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
        throw err;
    }
}
