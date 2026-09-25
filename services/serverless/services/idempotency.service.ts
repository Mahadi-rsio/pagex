import { createHash } from 'node:crypto'
import { and, eq, lt } from 'drizzle-orm'
import { db } from '../infrastructure/db/db.js'
import { idempotencyKeys } from '../infrastructure/db/schema.js'
import { HttpError } from '../utils/http-error.js'

export interface IdempotencyResult<T> {
    isNew: boolean
    /** NULL = operation in progress (or failed); UUID = completed */
    resourceId: string | null
    /** True if this request is replaying a completed operation */
    replay?: boolean
    data?: T
}

/**
 * Check if an idempotency key exists and return the associated resource.
 * If not found, reserve the key for the current request.
 *
 * Behavior:
 *  CASE 1 — No existing key (or key in 'failed' state):
 *    → Reserve key with status = 'in_progress', resource_id = NULL.
 *    → Returns { isNew: true, resourceId: null }
 *
 *  CASE 2 — Existing key with status = 'in_progress':
 *    → Operation is already running. Do NOT create another.
 *    → Returns { isNew: false, replay: false, resourceId: null }
 *
 *  CASE 3 — Existing key with status = 'completed':
 *    → Operation already finished. Return the existing resource from PostgreSQL.
 *    → Returns { isNew: false, replay: true, resourceId: UUID }
 *
 * PostgreSQL is the source of truth. This function does NOT touch Redis.
 *
 * Race safety: the INSERT … ON CONFLICT DO NOTHING ensures exactly one reservation
 * wins even when two requests arrive simultaneously with the same key.
 *
 * 'failed' keys are eligible for re-reservation so callers can retry after a
 * genuine failure (lock failure, validation error, etc.). The re-reservation
 * uses an UPDATE rather than a fresh INSERT so the same primary-key row is
 * reused — this avoids a brief window where both the old DELETE and a new INSERT
 * could race.
 */
export async function checkAndReserveIdempotencyKey(opts: {
    tenantId: string
    pageId: string
    idempotencyKey: string
    resourceType: 'deployment' | 'build'
    requestBody: unknown
    ttlSeconds: number
}): Promise<IdempotencyResult<never>> {
    const requestHash = createHash('sha256').update(JSON.stringify(opts.requestBody)).digest('hex')
    const expiresAt = new Date(Date.now() + opts.ttlSeconds * 1000)

    // Attempt to insert a fresh reservation.
    // ON CONFLICT DO NOTHING means at most one row is ever created for a given
    // (tenant_id, page_id, idempotency_key) triple.
    const [inserted] = await db
        .insert(idempotencyKeys)
        .values({
            tenant_id: opts.tenantId,
            page_id: opts.pageId,
            idempotency_key: opts.idempotencyKey,
            resource_type: opts.resourceType,
            status: 'in_progress',
            resource_id: null,
            request_hash: requestHash,
            expires_at: expiresAt,
        })
        .onConflictDoNothing({
            target: [
                idempotencyKeys.tenant_id,
                idempotencyKeys.page_id,
                idempotencyKeys.idempotency_key,
            ],
        })
        .returning()

    if (inserted) {
        // CASE 1 — brand-new reservation.
        return { isNew: true, resourceId: null }
    }

    // Key already exists — read the current state.
    const [existing] = await db
        .select()
        .from(idempotencyKeys)
        .where(
            and(
                eq(idempotencyKeys.tenant_id, opts.tenantId),
                eq(idempotencyKeys.page_id, opts.pageId),
                eq(idempotencyKeys.idempotency_key, opts.idempotencyKey),
            ),
        )
        .limit(1)

    if (!existing) {
        // Extremely rare: key was inserted then immediately deleted (e.g. cascaded
        // page delete) between our two queries. Treat as a new reservation attempt
        // and let the caller retry.
        throw new HttpError('Idempotency key conflict — please retry', 409)
    }

    // CASE 3 — operation already completed. Return the existing resource.
    if (existing.status === 'completed' && existing.resource_id) {
        return { isNew: false, resourceId: existing.resource_id, replay: true }
    }

    // CASE 1 (re-reservation) — previous attempt failed terminally.
    // Re-activate the row so the caller can try again.
    if (existing.status === 'failed') {
        const [reactivated] = await db
            .update(idempotencyKeys)
            .set({
                status: 'in_progress',
                resource_id: null,
                request_hash: requestHash,
                expires_at: expiresAt,
            })
            .where(
                and(
                    eq(idempotencyKeys.tenant_id, opts.tenantId),
                    eq(idempotencyKeys.page_id, opts.pageId),
                    eq(idempotencyKeys.idempotency_key, opts.idempotencyKey),
                    // Only reactivate if still 'failed' — guards against a concurrent
                    // caller that already won the re-reservation race.
                    eq(idempotencyKeys.status, 'failed'),
                ),
            )
            .returning()

        if (reactivated) {
            // This caller won the re-reservation.
            return { isNew: true, resourceId: null }
        }

        // A concurrent caller beat us to the re-reservation; re-read the state.
        const [after] = await db
            .select()
            .from(idempotencyKeys)
            .where(
                and(
                    eq(idempotencyKeys.tenant_id, opts.tenantId),
                    eq(idempotencyKeys.page_id, opts.pageId),
                    eq(idempotencyKeys.idempotency_key, opts.idempotencyKey),
                ),
            )
            .limit(1)

        if (!after) {
            throw new HttpError('Idempotency key conflict — please retry', 409)
        }

        if (after.status === 'completed' && after.resource_id) {
            return { isNew: false, resourceId: after.resource_id, replay: true }
        }

        // Concurrent caller got 'in_progress'; this request is a duplicate.
        return { isNew: false, resourceId: null, replay: false }
    }

    // CASE 2 — operation is still in progress. Do NOT create another deployment.
    return { isNew: false, resourceId: null, replay: false }
}

/**
 * Mark an idempotency key as completed and record the created resource ID.
 * This is durable in PostgreSQL and must not rely on Redis.
 */
export async function completeIdempotencyKey(opts: {
    tenantId: string
    pageId: string
    idempotencyKey: string
    resourceId: string
}): Promise<void> {
    await db
        .update(idempotencyKeys)
        .set({
            status: 'completed',
            resource_id: opts.resourceId,
        })
        .where(
            and(
                eq(idempotencyKeys.tenant_id, opts.tenantId),
                eq(idempotencyKeys.page_id, opts.pageId),
                eq(idempotencyKeys.idempotency_key, opts.idempotencyKey),
            ),
        )
}

/**
 * Mark an idempotency key as failed (terminal state).
 *
 * The row is intentionally KEPT (not deleted) so a concurrent caller that was
 * blocked on the unique-constraint INSERT can observe the 'failed' status and
 * decide not to proceed — preventing a double-deployment race.
 *
 * The failed key is eligible for re-reservation via checkAndReserveIdempotencyKey
 * if the same idempotency key is submitted again after the failure.
 */
export async function failIdempotencyKey(opts: {
    tenantId: string
    pageId: string
    idempotencyKey: string
}): Promise<void> {
    await db
        .update(idempotencyKeys)
        .set({ status: 'failed' })
        .where(
            and(
                eq(idempotencyKeys.tenant_id, opts.tenantId),
                eq(idempotencyKeys.page_id, opts.pageId),
                eq(idempotencyKeys.idempotency_key, opts.idempotencyKey),
                // Only mark failed if still in_progress — do not overwrite completed.
                eq(idempotencyKeys.status, 'in_progress'),
            ),
        )
}

/**
 * DB-only lookup for completed idempotency keys (no Redis).
 * Returns the completed operation record, or null if not found / not yet completed.
 *
 * Survives Redis restart, API restart, and process crashes because PostgreSQL is
 * the sole source of truth.
 */
export async function findCompletedIdempotencyByKey(opts: {
    tenantId: string
    idempotencyKey: string
}): Promise<{
    resource_id: string
    resource_type: string
    page_id: string
} | null> {
    const [result] = await db
        .select({
            resource_id: idempotencyKeys.resource_id,
            resource_type: idempotencyKeys.resource_type,
            page_id: idempotencyKeys.page_id,
            status: idempotencyKeys.status,
        })
        .from(idempotencyKeys)
        .where(
            and(
                eq(idempotencyKeys.tenant_id, opts.tenantId),
                eq(idempotencyKeys.idempotency_key, opts.idempotencyKey),
            ),
        )
        .limit(1)

    // Only return if status = 'completed' and resource_id is set.
    if (!result || result.status !== 'completed' || !result.resource_id) return null

    return {
        resource_id: result.resource_id,
        resource_type: result.resource_type,
        page_id: result.page_id,
    }
}

/**
 * Clean up expired idempotency keys.
 * Uses lt() (strictly less than) so we delete keys whose expiry is in the past.
 */
export async function cleanupExpiredIdempotencyKeys(): Promise<number> {
    const now = new Date()

    const expiredKeys = await db
        .select({ id: idempotencyKeys.id })
        .from(idempotencyKeys)
        .where(lt(idempotencyKeys.expires_at, now))

    if (expiredKeys.length === 0) return 0

    await db
        .delete(idempotencyKeys)
        .where(lt(idempotencyKeys.expires_at, now))

    return expiredKeys.length
}
