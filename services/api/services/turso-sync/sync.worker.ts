import type { SyncEvent, SyncRepository } from './sync.repository.js'
import type { TursoRepository } from './turso.repository.js'
import { treeHash } from './tree-hash.js'

export interface SyncWorkerDeps {
    syncRepo: SyncRepository
    tursoRepo: TursoRepository
    log: (line: string) => void
}

export interface SyncResult {
    outcome: 'completed'
    entryCount: number
    durationMs: number
}

export class SyncWorkerError extends Error {
    constructor(message: string) {
        super(message)
        this.name = 'SyncWorkerError'
    }
}

/**
 * Core Turso sync step, shared by the BullMQ worker and the backfill script.
 *
 *  1. Load the deployment's immutable blob tree from PostgreSQL.
 *  2. Write the complete tree to Turso in one atomic transaction.
 *  3. Publish the active pointer ONLY if this deployment is still the active one
 *     in PostgreSQL (is_active). This is what defeats out-of-order application:
 *     a superseded deployment can never re-publish itself, while a rollback
 *     (which flips is_active back to an older deployment) still works.
 *  4. Mark the outbox event completed.
 *
 * Idempotent by construction: every Turso write uses INSERT … ON CONFLICT
 * DO UPDATE, so re-running the same deployment converges to the same state.
 */
export class SyncWorker {
    constructor(private readonly deps: SyncWorkerDeps) {}

    async process(event: SyncEvent): Promise<SyncResult> {
        const { syncRepo, tursoRepo, log } = this.deps
        const started = Date.now()

        log(
            `sync.started site_id=${event.siteId} deployment_id=${event.deploymentId} ` +
                `version=${event.version}`
        )
        await syncRepo.recordAttempt(event.id)

        const entries = await syncRepo.loadDeploymentTree(event.deploymentId)
        if (entries.length === 0) {
            throw new SyncWorkerError(
                `deployment ${event.deploymentId} has an empty blob tree; refusing to sync`
            )
        }

        const hash = treeHash(entries)
        const active = await syncRepo.isDeploymentActive(event.deploymentId)

        await tursoRepo.writeDeploymentTree({
            siteId: event.siteId,
            deploymentId: event.deploymentId,
            version: event.version,
            entries,
            treeHashValue: hash,
            active,
        })

        await syncRepo.markCompleted(event.id)

        const durationMs = Date.now() - started
        log(
            `sync.success site_id=${event.siteId} deployment_id=${event.deploymentId} ` +
                `version=${event.version} entries=${entries.length} active=${active} ` +
                `duration_ms=${durationMs}`
        )

        return { outcome: 'completed', entryCount: entries.length, durationMs }
    }
}