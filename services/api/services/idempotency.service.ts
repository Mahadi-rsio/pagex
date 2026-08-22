import { createHash } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { db } from '../infrastructure/db/db.js'
import { idempotencyKeys } from '../infrastructure/db/schema.js'
import { HttpError } from '../utils/http-error.js'

export interface IdempotencyResult<T> {
    isNew: boolean
    resourceId: string
    data?: T
}

/**
 * Check if an idempotency key exists and return the associated resource.
 * If not found, reserve the key for the current request.
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
            resource_id: '', // Placeholder, will be updated after resource creation
            request_hash: requestHash,
            expires_at: expiresAt,
        })
        .onConflictDoNothing({ target: [idempotencyKeys.tenant_id, idempotencyKeys.page_id, idempotencyKeys.idempotency_key] })
        .returning()

    if (inserted) {
        // This is a new request, key was reserved
        return { isNew: true, resourceId: '' }
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

    // Verify request hash matches (optional but recommended for safety)
    if (existing.request_hash && existing.request_hash !== requestHash) {
        throw new HttpError('Idempotency key reused with different request payload', 409)
    }

    if (!existing.resource_id) {
        // Resource creation is still in progress
        throw new HttpError('Deployment already in progress for this idempotency key', 409)
    }

    return { isNew: false, resourceId: existing.resource_id }
}

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