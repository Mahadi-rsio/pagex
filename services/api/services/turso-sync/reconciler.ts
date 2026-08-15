import type { ActiveDeploymentRef, SyncRepository } from './sync.repository.js'
import type { TursoRepository } from './turso.repository.js'

export type RepairReason =
    | 'no_pointer'
    | 'stale_pointer'
    | 'missing_metadata'

export interface ReconcilerDeps {
    syncRepo: SyncRepository
    tursoRepo: TursoRepository
    /** Re-enqueue a deployment for sync (upsert outbox + enqueue BullMQ job). */
    enqueue: (ref: ActiveDeploymentRef) => Promise<void>
    log: (line: string) => void
}

export interface ReconcileResult {
    checked: number
    repaired: number
    durationMs: number
}

/**
 * Periodic guard against lost/duplicated/out-of-order sync events.
 *
 * Compares PostgreSQL's active deployment metadata against Turso and re-enqueues
 * when they disagree. It deliberately avoids comparing full trees every cycle:
 * the cheap check is the active pointer + the presence of tree metadata. A full
 * re-sync (which recomputes the tree checksum) only happens when those disagree,
 * or when the outbox row is stale/failed and reconciliation re-enqueues it.
 */
export class Reconciler {
    constructor(private readonly deps: ReconcilerDeps) {}

    async run(): Promise<ReconcileResult> {
        const { syncRepo, tursoRepo, enqueue, log } = this.deps
        const started = Date.now()

        log('reconciliation.started')
        const active = await syncRepo.getActiveDeployments()

        let repaired = 0
        for (const ref of active) {
            const reason = await this.findRepairReason(ref)
            if (reason === null) continue

            await enqueue(ref)
            repaired++
            log(
                `reconciliation.repaired site_id=${ref.siteId} deployment_id=${ref.deploymentId} ` +
                    `version=${ref.version} reason=${reason}`
            )
        }

        const durationMs = Date.now() - started
        log(
            `reconciliation.completed checked=${active.length} repaired=${repaired} ` +
                `duration_ms=${durationMs}`
        )
        return { checked: active.length, repaired, durationMs }
    }

    private async findRepairReason(ref: ActiveDeploymentRef): Promise<RepairReason | null> {
        const { syncRepo, tursoRepo } = this.deps

        const pointer = await tursoRepo.getPointer(ref.siteId)
        if (!pointer) return 'no_pointer'

        if (pointer.deploymentId !== ref.deploymentId) return 'stale_pointer'

        // Pointer matches but metadata is missing → tree is incomplete or was
        // never fully written (e.g. a pre-metadata legacy sync). Re-sync.
        const meta = await tursoRepo.getTreeMetadata(ref.deploymentId)
        if (!meta) return 'missing_metadata'

        // Sanity: entry count must match PostgreSQL's authoritative count.
        const count = await syncRepo.countDeploymentEntries(ref.deploymentId)
        if (meta.entryCount !== count) return 'missing_metadata'

        return null
    }
}