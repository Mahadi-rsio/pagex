export const TOP_LEVEL_DOMAIN = process.env.BASE_DOMAIN || 'localhost'
export const MAX_FILE_SIZE = 250 * 1024 * 1024
/** Max size for a single file in a content-addressed deploy */
export const MAX_DEPLOY_FILE_SIZE = 50 * 1024 * 1024
/** Redis TTL for deploy:token:{token} (10 minutes) */
export const DEPLOY_TOKEN_TTL_SECONDS = 10 * 60
/** Presigned PUT URL lifetime (matches deploy token window) */
export const PRESIGN_EXPIRY_SECONDS = 10 * 60
/** Keep this many recent deployments per page */
export const DEPLOYMENT_RETENTION = 10
/** Redis TTL for site_files:{siteId} path→blob map (24 hours) */
export const SITE_FILES_TTL_SECONDS = 24 * 60 * 60
/** Commit endpoint request timeout (5 minutes) */
export const COMMIT_TIMEOUT_MS = 5 * 60 * 1000
/** Concurrency limit for parallel blob I/O */
export const BLOB_IO_CONCURRENCY = 10

export const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000
export const RATE_LIMIT_MAX = 100

export const SYNC_CRON_PATTERN = '0 */2 * * * *'
