import { and, desc, eq, inArray, notInArray } from 'drizzle-orm'
import { DEPLOYMENT_RETENTION } from '../constants/index.js'
import { db } from '../infrastructure/db/db.js'
import { blobTreeEntries, blobs, deployments } from '../infrastructure/db/schema.js'
import { deleteBlobObjects } from '../infrastructure/storage/minio.js'

/**
 * Background GC: drop inactive deployments beyond retention and delete
 * truly orphaned MinIO blobs. Safe to fire-and-forget — never await at call site.
 *
 * @param pageId - page whose deployment history to prune
 * @param _siteId - retained for call-site symmetry / future use (blobs are global)
 */
export async function runDeploymentGC(pageId: string, _siteId: string): Promise<void> {
    // Step 1 — expired inactive deployments (active is never a target)
    const expired = await db
        .select({ id: deployments.id })
        .from(deployments)
        .where(and(eq(deployments.page_id, pageId), eq(deployments.is_active, false)))
        .orderBy(desc(deployments.created_at))
        .offset(DEPLOYMENT_RETENTION)

    if (expired.length === 0) return

    const expiredIds = expired.map((d) => d.id)

    // Step 2 — candidate blob hashes from expired deployments
    const candidateRows = await db
        .selectDistinct({ blobHash: blobTreeEntries.blobHash })
        .from(blobTreeEntries)
        .where(inArray(blobTreeEntries.deploymentId, expiredIds))

    const candidateHashes = candidateRows.map((r) => r.blobHash)

    // Step 3 — cross-check: drop hashes still referenced by non-expired deployments
    let orphanedHashes: string[] = []
    if (candidateHashes.length > 0) {
        const stillReferenced = await db
            .selectDistinct({ blobHash: blobTreeEntries.blobHash })
            .from(blobTreeEntries)
            .where(
                and(
                    inArray(blobTreeEntries.blobHash, candidateHashes),
                    notInArray(blobTreeEntries.deploymentId, expiredIds)
                )
            )

        const stillSet = new Set(stillReferenced.map((r) => r.blobHash))
        orphanedHashes = candidateHashes.filter((h) => !stillSet.has(h))
    }

    // Prefetch sizes for the log (before DB delete)
    let bytesFreed = 0
    let deletedHashes: string[] = []

    if (orphanedHashes.length > 0) {
        const sizeRows = await db
            .select({ hash: blobs.hash, size: blobs.size })
            .from(blobs)
            .where(inArray(blobs.hash, orphanedHashes))
        const sizeByHash = new Map(sizeRows.map((r) => [r.hash, r.size]))

        // Step 4 — MinIO first; only successfully deleted hashes proceed to blobs DELETE
        deletedHashes = await deleteBlobObjects(orphanedHashes)
        for (const hash of deletedHashes) {
            bytesFreed += sizeByHash.get(hash) ?? 0
        }
    }

    // Step 5 — DB transaction: tree → deployments → blobs (successful MinIO only)
    await db.transaction(async (tx) => {
        await tx
            .delete(blobTreeEntries)
            .where(inArray(blobTreeEntries.deploymentId, expiredIds))

        await tx.delete(deployments).where(inArray(deployments.id, expiredIds))

        if (deletedHashes.length > 0) {
            await tx.delete(blobs).where(inArray(blobs.hash, deletedHashes))
        }
    })

    // Step 6 — log result
    const mbFreed = (bytesFreed / (1024 * 1024)).toFixed(1)
    console.log(
        `GC complete: ${expiredIds.length} deployments cleaned, ${deletedHashes.length} blobs deleted, ${mbFreed} MB freed`
    )
}
