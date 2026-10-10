export const TOP_LEVEL_DOMAIN = process.env.BASE_DOMAIN || "localhost";
export const MAX_FILE_SIZE = 250 * 1024 * 1024;
/** Max size for a single file in a content-addressed deploy */
export const MAX_DEPLOY_FILE_SIZE = 50 * 1024 * 1024;
/** Redis TTL for deploy:token:{token} (10 minutes) */
export const DEPLOY_TOKEN_TTL_SECONDS = 10 * 60;
/** Presigned PUT URL lifetime (matches deploy token window) */
export const PRESIGN_EXPIRY_SECONDS = 10 * 60;
/** Keep this many recent deployments per page */
export const DEPLOYMENT_RETENTION = 10;
/** Redis TTL for manifest:{deploymentId} cached manifest JSON (24 hours) */
export const MANIFEST_REDIS_TTL_SECONDS = 24 * 60 * 60;
/** Current deployment manifest schema version */
export const DEPLOYMENT_MANIFEST_VERSION = 1;
/** Max serialized manifest size (50 MB) */
export const MAX_MANIFEST_SIZE_BYTES = 50 * 1024 * 1024;
/** Commit endpoint request timeout (5 minutes) */
export const COMMIT_TIMEOUT_MS = 5 * 60 * 1000;
/** Redis TTL for deploy:lock:{pageId} taken at prepare (matches token window) */
export const DEPLOY_LOCK_PREPARE_TTL_SECONDS = DEPLOY_TOKEN_TTL_SECONDS;
/** Redis TTL while commit/rollback holds the lock (commit timeout + 60s buffer) */
export const DEPLOY_LOCK_COMMIT_TTL_SECONDS =
    Math.ceil(COMMIT_TIMEOUT_MS / 1000) + 60;
/** Heartbeat interval to refresh a held deployment lock */
export const DEPLOY_LOCK_HEARTBEAT_MS = 30_000;
/** Concurrency limit for parallel blob I/O */
export const BLOB_IO_CONCURRENCY = 10;

export const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
export const RATE_LIMIT_MAX = 100;

// ---------------------------------------------------------------------------
// Shared remote build system
// ---------------------------------------------------------------------------

/** Max serialized build log retained per job (256 KB). */
export const MAX_BUILD_LOG_BYTES = 256 * 1024;

/** Single append payload cap accepted from the machine (64 KB). */
export const MAX_BUILD_LOG_CHUNK_BYTES = 64 * 1024;

/** Lifetime of a build job token (covers clone+build+deploy). */
export const BUILD_JOB_TOKEN_TTL_SECONDS = 60 * 60;

/** Prefix that identifies a build job token (never a user JWT). */
export const BUILD_JOB_TOKEN_PREFIX = "pxb";

/** Number of automatic attempts before a job is permanently failed. */
export const BUILD_MAX_ATTEMPTS = 2;

/** Machine lease duration; a heartbeat refreshes it. */
export const BUILD_LEASE_SECONDS = 5 * 60;

/** Hard cap for a single build (clone + install + build + deploy). */
export const BUILD_TIMEOUT_MS = 20 * 60 * 1000;

/** Redis lock guarding start/stop decisions for the shared machine. */
export const BUILD_MACHINE_LOCK_KEY = "build:machine:lock";
export const BUILD_MACHINE_LOCK_TTL_SECONDS = 30;
