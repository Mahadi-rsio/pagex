import { enqueueBackgroundJob } from "@/server/api/queues/cloudflare-queue";
import {
    DEPLOYMENT_GC_JOB,
    PAGE_DELETE_JOB,
} from "@/server/api/queues/background-job";

/**
 * The two background cleanup jobs the console produces. Both are fired only
 * AFTER the matching PostgreSQL write has committed, and neither is awaited in a
 * way that can fail the caller — `enqueueBackgroundJob` resolves false on
 * failure rather than throwing.
 *
 * Both handlers in the Go worker (`services/worker`) are idempotent, so a
 * duplicate or retried delivery is safe.
 */

/**
 * Prune a page's deployment history after a successful activation.
 *
 * The active deployment is never a target, so enqueueing this right after
 * activation can never disturb the deployment the request just went live.
 */
export async function enqueueDeploymentGC(input: {
    pageId: string;
    siteId: string;
    deploymentId: string;
}): Promise<boolean> {
    return enqueueBackgroundJob({
        type: DEPLOYMENT_GC_JOB,
        page_id: input.pageId,
        site_id: input.siteId,
        deployment_id: input.deploymentId,
    });
}

/**
 * Purge every trace of a deleted project: deployments, blob references,
 * manifests, MinIO objects, and cached runtime state.
 *
 * Enqueue AFTER the `pages` row is gone and the site is deactivated, so a
 * failure here can only leak storage — it can never resurrect a deleted project
 * or resurrect a deployment on a dead site.
 */
export async function enqueuePageDelete(input: {
    pageId: string;
    siteId: string;
}): Promise<boolean> {
    return enqueueBackgroundJob({
        type: PAGE_DELETE_JOB,
        page_id: input.pageId,
        site_id: input.siteId,
    });
}
