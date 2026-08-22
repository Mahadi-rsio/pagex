import { createHash } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { db } from '../infrastructure/db/db.js'
import { idempotencyKeys } from '../infrastructure/db/schema.js'
import { HttpError } from '../utils/http-error.js'

export interface IdempotencyResult<T> {
    isNew: boolean
    /** NULL = operation in progress, UUID = completed */
    resourceId: string | null
    /** True if this request is replaying a completed operation */
    replay?: boolean
    data?: T
}

/**
 * Check if an idempotency key exists and return the associated resource.
 * If not found, reserve the key for the current request.
 *
 * Returns:
 *  - isNew: true → new reservation (resource_id = NULL)
 *  - isNew: false, replay: false, resourceId: null → operation in progress
 *  - isNew: false, replay: true, resourceId: UUID → completed, returning existing resource
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

    // Try to insert the idempotency key
    const [inserted] = await db
        .insert(idempotencyKeys)
        .values({
            tenant_id: opts.tenantId,
            page_id: opts.pageId,
            idempotency_key: opts.idempotencyKey,
            resource_type: opts.resourceType,
            resource_id: null, // NULL = in progress
            request_hash: requestHash,
            expires_at: expiresAt,
        })
        .onConflictDoNothing({ target: [idempotencyKeys.tenant_id, idempotencyKeys.page_id, idempotencyKeys.idempotency_key] })
        .returning()

    if (inserted) {
        // This is a new request, key was reserved
        return { isNew: true, resourceId: null }
    }

    // Key already exists, check if it matches the request
    const [existing] = await db
        .select()
        .from(idempotencyKeys)
        .where(and(
            eq(idempotencyKeys.tenant_id, opts.tenantId),
            eq(idempotencyKeys.page_id, opts.pageId),
            eq(idempotencyKeys.idempotency_key, opts.idempotencyKey)
        ))
        .limit(1)

    if (!existing) {
        // Race condition: key was deleted between check and insert
        throw new HttpError('Idempotency key conflict, please retry', 409)
    }

    if (!existing.resource_id) {
        // resource_id = NULL → operation is still in progress.
        // Retries and duplicate submissions return in-progress status.
        // Hash mismatch is not checked here — the in-progress reservation is
        // the source of truth; payload may differ across retries.
        return { isNew: false, resourceId: null, replay: false }
    }

    // resource_id is set → operation completed; replay the result.
    return { isNew: false, resourceId: existing.resource_id, replay: true }}

/**
 * Update the idempotency key with the created resource ID.
 */
export async function completeIdempotencyKey(opts: {
    tenantId: string
    pageId: string
    idempotencyKey: string
    resourceId: string
}): Promise<void> {
    await db
        .update(idempotencyKeys)
        .set({ resource_id: opts.resourceId })
        .where(and(
            eq(idempotencyKeys.tenant_id, opts.tenantId),
            eq(idempotencyKeys.page_id, opts.pageId),
            eq(idempotencyKeys.idempotency_key, opts.idempotencyKey)
        ))
}

/**
 * Mark an idempotency key as failed (release the reservation).
 */
export async function failIdempotencyKey(opts: {
    tenantId: string
    pageId: string
    idempotencyKey: string
}): Promise<void> {
    await db
        .delete(idempotencyKeys)
        .where(and(
            eq(idempotencyKeys.tenant_id, opts.tenantId),
            eq(idempotencyKeys.page_id, opts.pageId),
            eq(idempotencyKeys.idempotency_key, opts.idempotencyKey)
        ))
}

/**
 * DB-only lookup for completed idempotency keys (no Redis).
 * Returns the completed operation record, or null if not found / still in progress.
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
        })
        .from(idempotencyKeys)
        .where(and(
            eq(idempotencyKeys.tenant_id, opts.tenantId),
            eq(idempotencyKeys.idempotency_key, opts.idempotencyKey)
        ))
        .limit(1)

    // Only return if resource_id is set (operation completed)
    if (!result || !result.resource_id) return null

    return {
        resource_id: result.resource_id,
        resource_type: result.resource_type,
        page_id: result.page_id,
    }
}

/**
 * Clean up expired idempotency keys.
 */
export async function cleanupExpiredIdempotencyKeys(): Promise<number> {
    const expiredKeys = await db
        .select({ id: idempotencyKeys.id })
        .from(idempotencyKeys)
        .where(eq(idempotencyKeys.expires_at, new Date()))
    
    if (expiredKeys.length === 0) return 0
    
    await db
        .delete(idempotencyKeys)
        .where(eq(idempotencyKeys.expires_at, new Date()))
    
    return expiredKeys.length
}
