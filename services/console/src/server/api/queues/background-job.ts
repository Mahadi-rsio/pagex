/**
 * Background job contract for the Cloudflare Queue `pagex-background`.
 *
 * The queue is the ONLY async boundary in the control plane. Deployments stay
 * fully synchronous (upload → Brotli/Gzip → commit → manifest → activation →
 * Redis); only cleanup work is deferred, and the consumer is the Go worker in
 * `services/worker`.
 *
 * Producers are the console's feature services; they enqueue through the
 * native Worker binding `BACKGROUND_QUEUE` declared in `wrangler.jsonc` — no
 * HTTP publishing, no BullMQ/Redis queue.
 * The consumer must tolerate duplicate and retried deliveries, so every handler
 * here is written to be idempotent.
 */

export const DEPLOYMENT_GC_JOB = "deployment_gc";
export const PAGE_DELETE_JOB = "page_delete";

export interface DeploymentGCJob {
    type: typeof DEPLOYMENT_GC_JOB;
    page_id: string;
    site_id: string;
    deployment_id: string;
}

export interface PageDeleteJob {
    type: typeof PAGE_DELETE_JOB;
    page_id: string;
    site_id: string;
}

export type BackgroundJob = DeploymentGCJob | PageDeleteJob;

/**
 * Narrow an untrusted queue body to a known job.
 *
 * An unrecognised body is not an error the consumer should retry forever — the
 * worker ACKs it and logs, so a malformed message cannot wedge the queue.
 */
export function parseBackgroundJob(raw: unknown): BackgroundJob | null {
    if (typeof raw !== "object" || raw === null) return null;

    // A union, not an intersection: intersecting the two job types would
    // collapse the `type` discriminant to `never` and erase every property.
    const job = raw as Partial<DeploymentGCJob> | Partial<PageDeleteJob>;
    if (typeof job.type !== "string") return null;

    switch (job.type) {
        case DEPLOYMENT_GC_JOB:
            if (
                typeof job.page_id !== "string" ||
                typeof job.site_id !== "string" ||
                typeof job.deployment_id !== "string"
            ) {
                return null;
            }
            return {
                type: DEPLOYMENT_GC_JOB,
                page_id: job.page_id,
                site_id: job.site_id,
                deployment_id: job.deployment_id,
            };
        case PAGE_DELETE_JOB:
            if (
                typeof job.page_id !== "string" ||
                typeof job.site_id !== "string"
            ) {
                return null;
            }
            return {
                type: PAGE_DELETE_JOB,
                page_id: job.page_id,
                site_id: job.site_id,
            };
        default:
            return null;
    }
}
