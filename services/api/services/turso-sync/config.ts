/**
 * Turso read-model sync configuration.
 *
 * Sync is DISABLED unless TURSO_DATABASE_URL is set. TURSO_SYNC_ENABLED=1 is
 * an explicit opt-in so code can be deployed before Turso exists (Stage 1 of
 * the rollout). Credentials come only from the environment — never hardcoded.
 */

const parseMs = (raw: string | undefined, fallback: number): number => {
    if (!raw) return fallback
    const n = Number(raw)
    return Number.isFinite(n) && n > 0 ? n : fallback
}

const parsePositiveInt = (raw: string | undefined, fallback: number): number => {
    if (!raw) return fallback
    const n = Number.parseInt(raw, 10)
    return Number.isInteger(n) && n > 0 ? n : fallback
}

export interface TursoSyncConfig {
    /** libSQL/Turso database URL. Empty string disables sync. */
    url: string | undefined
    /** Optional libSQL auth token. Never logged. */
    authToken: string | undefined
    /** Master switch; sync runs only when url is set AND this is "1". */
    enabled: boolean
    /** How often the dispatcher polls the PostgreSQL outbox. */
    pollIntervalMs: number
    /** Max outbox rows claimed per dispatcher poll. */
    batchSize: number
    /** How often reconciliation compares PostgreSQL vs Turso. */
    reconciliationIntervalMs: number
    /** Age after which a row stuck in `processing` is reclaimed. */
    staleAfterMs: number
    /** BullMQ job attempts before giving up. */
    attempts: number
    /** BullMQ exponential backoff base delay. */
    backoffDelayMs: number
}

export function loadTursoSyncConfig(env: NodeJS.ProcessEnv = process.env): TursoSyncConfig {
    const url = env['TURSO_DATABASE_URL']
    const enabled = !!url && env['TURSO_SYNC_ENABLED'] === '1'
    return {
        url,
        authToken: env['TURSO_AUTH_TOKEN'],
        enabled,
        pollIntervalMs: parseMs(env['TURSO_SYNC_POLL_INTERVAL'], 5_000),
        batchSize: parsePositiveInt(env['TURSO_SYNC_BATCH_SIZE'], 25),
        reconciliationIntervalMs: parseMs(env['TURSO_RECONCILIATION_INTERVAL'], 15 * 60_000),
        staleAfterMs: parseMs(env['TURSO_SYNC_STALE_AFTER'], 5 * 60_000),
        attempts: parsePositiveInt(env['TURSO_SYNC_ATTEMPTS'], 5),
        backoffDelayMs: parseMs(env['TURSO_SYNC_BACKOFF_DELAY'], 5_000),
    }
}