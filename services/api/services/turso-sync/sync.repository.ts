import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import type { PgTransaction } from 'drizzle-orm/pg-core'
import { db } from '../../infrastructure/db/db.js'
import {
    blobTreeSyncOutbox,
    deployments,
    blobTreeEntries,
    type OutboxStatus,
} from '../../infrastructure/db/schema.js'
import type { TreeEntry } from './tree-hash.js'

export const OUTBOX_EVENT_TYPE = 'SYNC_DEPLOYMENT'

export interface SyncEvent {
    id: string
    siteId: string
    deploymentId: string
    version: number
    status: OutboxStatus
    attempts: number
    lastError: string | null
}

export interface ActiveDeploymentRef {
    siteId: string
    deploymentId: string
    version: number
}

type Tx = PgTransaction<any, any, any>

const mapRow = (row: typeof blobTreeSyncOutbox.$inferSelect): SyncEvent => ({
    id: row.id,
    siteId: row.site_id,
    deploymentId: row.deployment_id,
    version: row.version,
    status: row.status as OutboxStatus,
    attempts: row.attempts,
    lastError: row.last_error,
})

/**
 * PostgreSQL side of the Turso read-model sync.
 *
 * The outbox is the durability point: a deployment change and its `SYNC_DEPLOYMENT`
 * event are committed atomically, so a crash between them is impossible. Rows are
 * claimed with `FOR UPDATE SKIP LOCKED` so multiple worker processes never process
 * the same event concurrently.
 */
export interface SyncRepository {
    /** Insert (or re-enqueue) a sync event inside the deployment transaction. */
    enqueue(tx: Tx, opts: { siteId: string; deploymentId: string; version: number }): Promise<void>
    /** Same as enqueue but in its own transaction (reconciler / tooling). */
    enqueueDirect(opts: { siteId: string; deploymentId: string; version: number }): Promise<void>
    /** Record a deployment as already synced (backfill bookkeeping). */
    upsertCompleted(opts: { siteId: string; deploymentId: string; version: number }): Promise<void>
    /** Atomically claim up to `limit` pending events. */
    claimPending(limit: number): Promise<SyncEvent[]>
    getEvent(id: string): Promise<SyncEvent | null>
    recordAttempt(id: string): Promise<void>
    recordFailure(id: string, error: string): Promise<void>
    markCompleted(id: string): Promise<void>
    markFailed(id: string, error: string): Promise<void>
    /** Reclaim events stuck in `processing` (worker crash / lost BullMQ job). */
    resetStale(staleAfterMs: number): Promise<number>
    loadDeploymentTree(deploymentId: string): Promise<TreeEntry[]>
    countDeploymentEntries(deploymentId: string): Promise<number>
    isDeploymentActive(deploymentId: string): Promise<boolean>
    getActiveDeployments(): Promise<ActiveDeploymentRef[]>
}

export class PostgresSyncRepository implements SyncRepository {    async enqueue(tx: Tx, opts: { siteId: string; deploymentId: string; version: number }): Promise<void> {
        await tx
            .insert(blobTreeSyncOutbox)
            .values({
                site_id: opts.siteId,
                deployment_id: opts.deploymentId,
                version: opts.version,
                event_type: OUTBOX_EVENT_TYPE,
                status: 'pending',
                attempts: 0,
            })
            .onConflictDoUpdate({
                target: blobTreeSyncOutbox.deployment_id,
                set: {
                    site_id: opts.siteId,
                    version: opts.version,
                    status: 'pending',
                    attempts: 0,
                    last_error: null,
                    processed_at: null,
                    last_attempt_at: null,
                    created_at: new Date(),
                },
                // Never yank a row out from under an in-flight worker; re-enqueue
                // only terminal rows (completed/failed).
                where: sql`${blobTreeSyncOutbox.status} NOT IN ('pending', 'processing')`,
            })
    }

    async enqueueDirect(opts: { siteId: string; deploymentId: string; version: number }): Promise<void> {
        await db.transaction(async (tx) => {
            await this.enqueue(tx, opts)
        })
    }

    async upsertCompleted(opts: { siteId: string; deploymentId: string; version: number }): Promise<void> {
        await db.transaction(async (tx) => {
            await tx
                .insert(blobTreeSyncOutbox)
                .values({
                    site_id: opts.siteId,
                    deployment_id: opts.deploymentId,
                    version: opts.version,
                    event_type: OUTBOX_EVENT_TYPE,
                    status: 'completed',
                    processed_at: new Date(),
                })
                .onConflictDoUpdate({
                    target: blobTreeSyncOutbox.deployment_id,
                    set: {
                        site_id: opts.siteId,
                        version: opts.version,
                        status: 'completed',
                        processed_at: new Date(),
                        last_error: null,
                    },
                })
        })
    }

    async claimPending(limit: number): Promise<SyncEvent[]> {
        return db.transaction(async (tx) => {
            const rows = await tx
                .select()
                .from(blobTreeSyncOutbox)
                .where(eq(blobTreeSyncOutbox.status, 'pending'))
                .orderBy(asc(blobTreeSyncOutbox.created_at))
                .limit(limit)
                .for('update', { skipLocked: true })

            if (rows.length > 0) {
                const ids = rows.map((r) => r.id)
                await tx
                    .update(blobTreeSyncOutbox)
                    .set({ status: 'processing', last_attempt_at: new Date() })
                    .where(inArray(blobTreeSyncOutbox.id, ids))
            }
            return rows.map(mapRow)
        })
    }

    async getEvent(id: string): Promise<SyncEvent | null> {
        const rows = await db
            .select()
            .from(blobTreeSyncOutbox)
            .where(eq(blobTreeSyncOutbox.id, id))
            .limit(1)
        const row = rows[0]
        return row ? mapRow(row) : null
    }

    async recordAttempt(id: string): Promise<void> {
        await db
            .update(blobTreeSyncOutbox)
            .set({ attempts: sql`${blobTreeSyncOutbox.attempts} + 1`, last_attempt_at: new Date() })
            .where(eq(blobTreeSyncOutbox.id, id))
    }

    async recordFailure(id: string, error: string): Promise<void> {
        await db
            .update(blobTreeSyncOutbox)
            .set({ last_error: error })
            .where(eq(blobTreeSyncOutbox.id, id))
    }

    async markCompleted(id: string): Promise<void> {
        await db
            .update(blobTreeSyncOutbox)
            .set({ status: 'completed', processed_at: new Date(), last_error: null })
            .where(eq(blobTreeSyncOutbox.id, id))
    }

    async markFailed(id: string, error: string): Promise<void> {
        await db
            .update(blobTreeSyncOutbox)
            .set({ status: 'failed', last_error: error, processed_at: new Date() })
            .where(eq(blobTreeSyncOutbox.id, id))
    }

    async resetStale(staleAfterMs: number): Promise<number> {
        const cutoff = new Date(Date.now() - staleAfterMs).toISOString()
        const res = await db
            .update(blobTreeSyncOutbox)
            .set({ status: 'pending' })
            .where(
                and(
                    eq(blobTreeSyncOutbox.status, 'processing'),
                    sql`${blobTreeSyncOutbox.last_attempt_at} < ${cutoff}`
                )
            )
            .returning({ id: blobTreeSyncOutbox.id })
        return res.length
    }

    async loadDeploymentTree(deploymentId: string): Promise<TreeEntry[]> {
        const rows = await db
            .select({
                path: blobTreeEntries.path,
                blobHash: blobTreeEntries.blobHash,
            })
            .from(blobTreeEntries)
            .where(eq(blobTreeEntries.deploymentId, deploymentId))
        return rows.map((r) => ({ path: r.path, blobHash: r.blobHash }))
    }

    async countDeploymentEntries(deploymentId: string): Promise<number> {
        const rows = await db
            .select({ count: sql<number>`count(*)` })
            .from(blobTreeEntries)
            .where(eq(blobTreeEntries.deploymentId, deploymentId))
        return Number(rows[0]?.count ?? 0)
    }

    async isDeploymentActive(deploymentId: string): Promise<boolean> {
        const rows = await db
            .select({ active: deployments.is_active })
            .from(deployments)
            .where(eq(deployments.id, deploymentId))
            .limit(1)
        return rows[0]?.active ?? false
    }

    async getActiveDeployments(): Promise<ActiveDeploymentRef[]> {
        const rows = await db.execute<{
            site_id: string
            deployment_id: string
            version: number
        }>(
            sql`
            SELECT DISTINCT ON (d.site_id) d.site_id, d.id AS deployment_id, d.version
            FROM deployments d
            WHERE d.is_active = true
            ORDER BY d.site_id, d.version DESC
        `
        )
        return rows.map((r) => ({
            siteId: String(r.site_id),
            deploymentId: String(r.deployment_id),
            version: Number(r.version),
        }))
    }
}

export const syncRepository = new PostgresSyncRepository()

/**
 * Enqueue a `SYNC_DEPLOYMENT` event atomically with the deployment change.
 * Callers MUST pass the same transaction that mutates the deployment.
 */
export function enqueueDeploymentSync(
    tx: Tx,
    opts: { siteId: string; deploymentId: string; version: number }
): Promise<void> {
    return syncRepository.enqueue(tx, opts)
}