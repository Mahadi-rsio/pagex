/**
 * Initial backfill: replicate all ACTIVE deployments from PostgreSQL into Turso.
 *
 * Run once (re-runnable / resumable — every write is idempotent):
 *   npx tsx scripts/backfill-turso.ts
 *
 * Processes one deployment at a time (bounded memory), writes each deployment's
 * full tree in one atomic Turso transaction, publishes the active pointer, and
 * records a `completed` outbox row so the dispatcher does not re-sync it.
 */
import 'dotenv/config'
import { loadTursoSyncConfig } from '../services/turso-sync/config.js'
import { LibsqlTursoRepository } from '../services/turso-sync/turso.repository.js'
import { PostgresSyncRepository } from '../services/turso-sync/sync.repository.js'
import { SyncWorker } from '../services/turso-sync/sync.worker.js'
import type { SyncEvent } from '../services/turso-sync/sync.repository.js'

const config = loadTursoSyncConfig()

if (!config.url) {
    console.error('TURSO_DATABASE_URL is not set — nothing to backfill')
    process.exit(1)
}

const log = (line: string) => console.log(line)

const syncRepo = new PostgresSyncRepository()
const tursoRepo = new LibsqlTursoRepository({
    url: config.url,
    ...(config.authToken ? { authToken: config.authToken } : {}),
})
const worker = new SyncWorker({ syncRepo, tursoRepo, log })

async function main(): Promise<void> {
    await tursoRepo.ensureSchema()
    log('turso schema ready')

    const active = await syncRepo.getActiveDeployments()
    log(`backfill.started deployments=${active.length}`)

    if (active.length === 0) {
        log('backfill.completed deployments=0 nothing_to_do')
        return
    }

    const overallStart = Date.now()
    let done = 0
    let failed = 0

    for (const ref of active) {
        const event: SyncEvent = {
            id: `backfill:${ref.deploymentId}`,
            siteId: ref.siteId,
            deploymentId: ref.deploymentId,
            version: ref.version,
            status: 'pending',
            attempts: 0,
            lastError: null,
        }

        try {
            const res = await worker.process(event)
            // Bookkeeping so the dispatcher skips an already-synced deployment.
            await syncRepo.upsertCompleted(ref)
            done++
            log(
                `backfill.progress ${done}/${active.length} site_id=${ref.siteId} ` +
                    `deployment_id=${ref.deploymentId} version=${ref.version} ` +
                    `entries=${res.entryCount} duration_ms=${res.durationMs}`
            )
        } catch (err) {
            failed++
            const message = err instanceof Error ? err.message : String(err)
            log(
                `backfill.failed site_id=${ref.siteId} deployment_id=${ref.deploymentId} ` +
                    `version=${ref.version} error=${message}`
            )
        }
    }

    log(
        `backfill.completed total=${active.length} done=${done} failed=${failed} ` +
            `duration_ms=${Date.now() - overallStart}`
    )

    if (failed > 0) process.exit(1)
}

try {
    await main()
} finally {
    await tursoRepo.close()
}