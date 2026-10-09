import type { PageDeleteJob } from "../job";
import type { CleanupRepo } from "../repo";
import { deleteBlobObjects, deleteManifestObjects } from "../r2";
import { purgeDeletedPageCache, type RedisClient } from "../redis";
import { computeOrphanedHashes, type HandlerResult } from "./shared";

export interface PageDeleteDeps {
    repo: CleanupRepo;
    bucket: R2Bucket;
    redis: RedisClient | null;
    redisPrefix: string;
}

/**
 * Purge every trace of a soft-deleted project: deployments, blob references,
 * manifests, R2 objects and cached runtime state, then hard-delete the page row.
 *
 * Enqueued only AFTER the console soft-deletes the page and deactivates the
 * site (`services/console/src/features/projects/page.service.ts`), so a failure
 * here can only leak storage — it can never resurrect a deleted project.
 *
 * Safety guards make this idempotent and refuse to purge anything that is not
 * provably deleted:
 *  - page row missing            → skip (already purged or never existed)
 *  - page not soft-deleted       → permanent error, never purge a live project
 *  - page has an active deployment → permanent error, never break a live site
 *  - blob orphan check is cross-page, so blobs shared with live pages survive
 */
export async function runPageDelete(
    job: PageDeleteJob,
    deps: PageDeleteDeps,
): Promise<HandlerResult> {
    const { repo, bucket } = deps;

    // 1. Safety guard — the page must be soft-deleted before we purge anything.
    const page = await repo.findPageById(job.page_id);
    if (!page) {
        return {
            outcome: "skipped",
            reason: `page ${job.page_id} already purged (row not found)`,
        };
    }
    if (!page.deletedAt) {
        return {
            outcome: "permanent-error",
            reason: `page ${job.page_id} is not soft-deleted; refusing to purge a live project`,
        };
    }

    // 2. Collect every deployment of the page.
    const pageDeployments = await repo.findDeploymentsByPage(job.page_id);
    if (pageDeployments.some((d) => d.is_active)) {
        return {
            outcome: "permanent-error",
            reason: `page ${job.page_id} has an active deployment; refusing to purge`,
        };
    }
    const deploymentIds = pageDeployments.map((d) => d.id);

    // 3. Orphan detection — drop hashes still referenced by any OTHER page.
    const candidateHashes = await repo.findCandidateHashes(deploymentIds);
    let orphanedHashes: string[] = [];
    if (candidateHashes.length > 0) {
        const stillReferenced = await repo.findStillReferencedHashes(
            candidateHashes,
            deploymentIds,
        );
        orphanedHashes = computeOrphanedHashes(
            candidateHashes,
            stillReferenced,
        );
    }

    // 4. R2 first; only successfully deleted hashes proceed to blobs DELETE.
    let deletedHashes: string[] = [];
    if (orphanedHashes.length > 0) {
        deletedHashes = await deleteBlobObjects(bucket, orphanedHashes);
    }
    await deleteManifestObjects(bucket, deploymentIds);

    // 5. DB transaction: tree → deployments → blobs.
    await repo.purgeDeployments(deploymentIds, deletedHashes);

    // 6. Best-effort cache sweep (subdomain key falls back to project_name).
    const site = await repo.findSiteById(page.site_id);
    await purgeDeletedPageCache(deps.redis, deps.redisPrefix, {
        siteId: page.site_id,
        subdomain: site?.subdomain ?? page.project_name,
        domain: page.domain,
        deploymentIds,
    });

    // 7. Hard-delete the page row last (cascades builds/idempotency_keys).
    //    The sites row is intentionally kept: `sites.active = false` already
    //    stopped routing, and the schema only hard-deletes the pages row.
    await repo.hardDeletePage(job.page_id);

    const detail = `purged page ${job.page_id}: ${deploymentIds.length} deployments, ${deletedHashes.length} blobs deleted`;
    console.log(`[page-delete] ${detail}`);
    return { outcome: "completed", detail };
}
