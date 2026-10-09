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
 *  - blob orphan check is cross-page, so blobs shared with live pages survive
 *  - R2 objects are deleted before their DB references; a partial R2 failure
 *    throws (transient) so the message retries instead of orphaning files
 *
 * `deployments.is_active` is deliberately NOT a guard: the console's delete
 * flow only sets `pages.deleted_at` and `sites.active = false`, never clears
 * `is_active` (that flag is only rewritten by deploy/rollback). A soft-deleted
 * page is excluded from every API read path and its site no longer serves, so
 * treating a stale `is_active` row as "live" would permanently block the purge
 * and leak R2 objects.
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

    // 2. Collect every deployment of the page. `is_active` is intentionally not
    //    a blocker (see the header note) — the page is already soft-deleted.
    const pageDeployments = await repo.findDeploymentsByPage(job.page_id);
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

    // 4. R2 first. Never drop the DB references for an object that still lives
    //    in R2: a partial failure is thrown so the message is retried (deletes
    //    are idempotent) instead of ACKing and permanently orphaning files.
    let deletedHashes: string[] = [];
    if (orphanedHashes.length > 0) {
        deletedHashes = await deleteBlobObjects(bucket, orphanedHashes);
        if (deletedHashes.length !== orphanedHashes.length) {
            throw new Error(
                `R2 blob delete incomplete for page ${job.page_id}: ` +
                    `${deletedHashes.length}/${orphanedHashes.length} deleted; retrying`,
            );
        }
    }
    const deletedManifests = await deleteManifestObjects(bucket, deploymentIds);
    if (deletedManifests.length !== deploymentIds.length) {
        throw new Error(
            `R2 manifest delete incomplete for page ${job.page_id}: ` +
                `${deletedManifests.length}/${deploymentIds.length} deleted; retrying`,
        );
    }

    // 5. DB transaction: tree → deployments → blobs. Only reached once every
    //    R2 object above is confirmed gone.
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
