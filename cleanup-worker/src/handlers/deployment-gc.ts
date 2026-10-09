import type { DeploymentGCJob } from "../job";
import type { CleanupRepo } from "../repo";
import { deleteBlobObjects, deleteManifestObjects } from "../r2";
import { computeOrphanedHashes, type HandlerResult } from "./shared";

export interface DeploymentGCDeps {
    repo: CleanupRepo;
    bucket: R2Bucket;
}

/**
 * Prune a page's deployment history: drop inactive deployments beyond
 * retention and delete truly orphaned R2 blobs + immutable manifests.
 *
 * Mirrors `services/console/src/features/deployments/gc.service.ts`. The
 * active deployment is never a target. Idempotent: a re-delivery finds no
 * expired deployments and skips.
 */
export async function runDeploymentGC(
    job: DeploymentGCJob,
    deps: DeploymentGCDeps,
): Promise<HandlerResult> {
    const { repo, bucket } = deps;

    // Step 1 — expired inactive deployments (active is never a target)
    const expiredIds = await repo.findExpiredDeploymentIds(job.page_id);
    if (expiredIds.length === 0) {
        return {
            outcome: "skipped",
            reason: "no inactive deployments beyond retention",
        };
    }

    // Step 2 — candidate blob hashes from expired deployments
    const candidateHashes = await repo.findCandidateHashes(expiredIds);

    // Step 3 — cross-check: drop hashes still referenced by non-expired deployments
    let orphanedHashes: string[] = [];
    if (candidateHashes.length > 0) {
        const stillReferenced = await repo.findStillReferencedHashes(
            candidateHashes,
            expiredIds,
        );
        orphanedHashes = computeOrphanedHashes(
            candidateHashes,
            stillReferenced,
        );
    }

    // Step 4 — prefetch sizes for the log (before DB delete)
    let bytesFreed = 0;
    let deletedHashes: string[] = [];
    if (orphanedHashes.length > 0) {
        const sizes = await repo.findBlobSizes(orphanedHashes);
        const sizeByHash = new Map(sizes.map((r) => [r.hash, r.size]));

        // Step 4a — R2 first; only successfully deleted hashes proceed to blobs DELETE
        deletedHashes = await deleteBlobObjects(bucket, orphanedHashes);
        for (const hash of deletedHashes) {
            bytesFreed += sizeByHash.get(hash) ?? 0;
        }
    }

    // Step 4b — delete immutable manifests for permanently removed deployments
    const deletedManifests = await deleteManifestObjects(bucket, expiredIds);
    if (deletedManifests.length > 0) {
        console.log(
            `GC: removed ${deletedManifests.length} manifest object(s)`,
        );
    }

    // Step 5 — DB transaction: tree → deployments → blobs (successful R2 only)
    await repo.purgeDeployments(expiredIds, deletedHashes);

    // Step 6 — log result
    const mbFreed = (bytesFreed / (1024 * 1024)).toFixed(1);
    const detail = `${expiredIds.length} deployments cleaned, ${deletedHashes.length} blobs deleted, ${mbFreed} MB freed`;
    console.log(`GC complete (page ${job.page_id}): ${detail}`);
    return { outcome: "completed", detail };
}
