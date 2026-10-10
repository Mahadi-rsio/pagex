/** How many inactive deployments per page are kept after a GC run. */
export const DEPLOYMENT_RETENTION = 10;

/** R2 bulk-delete batch size (matches the console's blob-server helpers). */
export const BLOB_DELETE_BATCH_SIZE = 100;

/** Max concurrent R2 batch deletes. */
export const BLOB_DELETE_CONCURRENCY = 10;

/** Per-message retries before the worker gives up and ACKs (matches wrangler.jsonc). */
export const QUEUE_MAX_RETRIES = 5;

export const BLOB_PREFIX = "blobs/";
export const MANIFEST_PREFIX = "manifests/";

/** Content-addressed blob object key. */
export function blobObjectKey(hash: string): string {
    return `${BLOB_PREFIX}${hash}`;
}

/** Immutable deployment manifest object key. */
export function manifestObjectKey(deploymentId: string): string {
    return `${MANIFEST_PREFIX}${deploymentId}.manifest.json`;
}

/**
 * Redis keys — mirrored from the console's infrastructure:
 *   services/console/src/server/api/infrastructure/cache/routing.ts
 *   services/console/src/server/api/infrastructure/cache/redis.ts
 */
export function redisKey(prefix: string, key: string): string {
    return `${prefix}:${key}`;
}

export function subdomainMappingKey(subdomain: string): string {
    return `site:subdomain:${subdomain}`;
}

export function activeDeploymentMappingKey(siteId: string): string {
    return `site:${siteId}:active`;
}

export function siteFilesKey(siteId: string): string {
    return `site_files:${siteId}`;
}

export function siteVersionKey(siteId: string): string {
    return `site_version:${siteId}`;
}

export function manifestRedisKey(deploymentId: string): string {
    return `manifest:${deploymentId}`;
}

export function dbCacheKey(domain: string): string {
    return `db_cache:${domain}`;
}

export function requestsKey(domain: string): string {
    return `requests:${domain}`;
}

export function bandwidthKey(domain: string): string {
    return `bandwidth:${domain}`;
}
