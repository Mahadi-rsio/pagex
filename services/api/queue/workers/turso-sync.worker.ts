/**
 * Turso read-model sync worker (separate container, profile: workers).
 *
 * Runs three loops in one process:
 *
 *   dispatcher   — polls the PostgreSQL outbox (FOR UPDATE SKIP LOCKED) and
 *                  enqueues BullMQ jobs. At-least-once: a crash after claim is
 *                  repaired by `resetStale`, which returns stuck `processing`
 *                  rows to `pending`.
 *   worker       — BullMQ consumer that runs the sync step. Retries with
 *                  exponential backoff; only marks the outbox completed after
 *                  Turso committed the full tree.
 *   reconciler   — periodic PostgreSQL↔Turso metadata comparison that re-enqueues
 *                  any active deployment Turso is missing or stale on.
 *
 * Exit(0) immediately when Turso sync is disabled so Stage 1 (code deployed,
 * Turso absent) is a no-op.
 */
import { Worker } from 'bullmq'
import { loadTursoSyncConfig } from '../../services/turso-sync/config.js'
import { LibsqlTursoRepository } from '../../services/turso-sync/turso.repository.js'
import { PostgresSyncRepository } from '../../services/turso-sync/sync.repository.js'
import { SyncWorker } from '../../services/turso-sync/sync.worker.js'
import { Reconciler } from '../../services/turso-sync/reconciler.js'
import { TURSO_SYNC_QUEUE, tursoSyncQueue, type TursoSyncJobData } from '../jobs/turso-sync.queue.js'
import { connection } from '../../infrastructure/cache/redis.js'

const log = (line: string) => console.log(line)
const config = loadTursoSyncConfig()

if (!config.enabled) {
    log('turso-sync disabled (set TURSO_DATABASE_URL and TURSO_SYNC_ENABLED=1 to enable)')
    process.exit(0)
}
if (!config.url) {
    log('turso-sync disabled (TURSO_DATABASE_URL is empty)')
    process.exit(0)
}

const syncRepo = new PostgresSyncRepository()
const tursoRepo = new LibsqlTursoRepository({
    url: config.url,
    ...(config.authToken ? { authToken: config.authToken } : {}),
})

await tursoRepo.ensureSchema()
log('turso schema ready')

const syncWorker = new SyncWorker({ syncRepo, tursoRepo, log })
const reconciler = new Reconciler({
    syncRepo,
    tursoRepo,
    log,
    enqueue: async (ref) => {
        // Upsert the outbox row back to `pending`; the dispatcher loop picks it
        // up on its next poll. No direct queue add — dedupe stays in the outbox.
        await syncRepo.enqueueDirect(ref)
    },
})

const worker = new Worker<TursoSyncJobData>(
    TURSO_SYNC_QUEUE,
    async (job) => {
        const event = await syncRepo.getEvent(job.data.outboxId)
        if (!event) {
            // Deployment deleted by GC between claim and execution — nothing to do.
            log(`sync.skipped outbox_id=${job.data.outboxId} reason=event_missing`)
            return
        }
        try {
            await syncWorker.process(event)
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err)
            await syncRepo.recordFailure(event.id, message)
            throw err
        }
    },
    {
        connection,
        concurrency: 2,
    }
)

worker.on('failed', (job, err) => {
    const msg = err instanceof Error ? err.message : String(err)
    log(
        `sync.failed job_id=${job?.id} attempt=${job?.attemptsMade ?? '?'} error=${msg}`
    )
})

worker.on('error', (err) => {
    log(`turso-sync worker error: ${err instanceof Error ? err.message : String(err)}`)
})

const enqueueFromOutbox = async () => {
    const events = await syncRepo.claimPending(config.batchSize)
    for (const event of events) {
        await tursoSyncQueue.add(
            'sync-deployment',
            { outboxId: event.id },
            {
                jobId: `turso-sync:${event.id}`,
                attempts: config.attempts,
                backoff: { type: 'exponential', delay: config.backoffDelayMs },
                removeOnComplete: 100,
                removeOnFail: 500,
            }
        )
        log(
            `dispatcher.enqueued outbox_id=${event.id} site_id=${event.siteId} ` +
                `deployment_id=${event.deploymentId} version=${event.version}`
        )
    }
    return events.length
}

const resetStale = async () => {
    const n = await syncRepo.resetStale(config.staleAfterMs)
    if (n > 0) log(`dispatcher.reclaimed_stale count=${n}`)
}

const dispatchTimer = setInterval(() => {
    enqueueFromOutbox().catch((err) =>
        log(`dispatcher.error ${err instanceof Error ? err.message : String(err)}`)
    )
}, config.pollIntervalMs)

const staleTimer = setInterval(() => {
    resetStale().catch((err) =>
        log(`dispatcher.error ${err instanceof Error ? err.message : String(err)}`)
    )
}, Math.max(config.pollIntervalMs, 30_000))

const reconcileTimer = setInterval(() => {
    reconciler
        .run()
        .catch((err) =>
            log(`reconciliation.error ${err instanceof Error ? err.message : String(err)}`)
        )
}, config.reconciliationIntervalMs)

log(
    `turso-sync worker running poll_ms=${config.pollIntervalMs} batch=${config.batchSize} ` +
        `reconcile_ms=${config.reconciliationIntervalMs} attempts=${config.attempts}`
)

// Run once at startup (cheap metadata scan, heals any drift accumulated while
// the worker was down) and again after reconcileIntervalMs.
reconciler
    .run()
    .catch((err) =>
        log(`reconciliation.error ${err instanceof Error ? err.message : String(err)}`)
    )

const shutdown = async (signal: string) => {
    log(`turso-sync shutting down (${signal})`)
    clearInterval(dispatchTimer)
    clearInterval(staleTimer)
    clearInterval(reconcileTimer)
    await worker.close()
    await tursoSyncQueue.close()
    await tursoRepo.close()
    process.exit(0)
}

process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('SIGINT', () => void shutdown('SIGINT'))