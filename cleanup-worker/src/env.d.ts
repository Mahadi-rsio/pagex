/**
 * Optional environment variables not declared in wrangler.jsonc.
 * Merged into the generated global `Env` interface (worker-configuration.d.ts)
 * via interface declaration merging. Secrets are injected with
 * `wrangler secret put` / `.dev.vars`, never committed.
 */
interface Env {
    /** Upstash REST API URL — Redis cache purge. Optional (skipped when unset). */
    UPSTASH_REDIS_REST_URL?: string;
    UPSTASH_REDIS_REST_TOKEN?: string;
    /** Redis key prefix; defaults to "px" to match the console. */
    REDIS_KEY_PREFIX?: string;
    /** Fallback connection string for local tooling without a HYPERDRIVE binding. */
    DATABASE_URL?: string;
}
