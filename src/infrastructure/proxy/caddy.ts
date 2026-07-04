/**
 * caddy.ts — DEPRECATED in vps/dev
 *
 * With the caddy static_s3 plugin, routing is handled automatically:
 *   subdomain → sites.id (PostgreSQL) → S3 key prefix
 *
 * There is no longer a need to call the Caddy admin API to add/remove routes.
 * This file is kept as a stub to avoid breaking any remaining import references
 * during migration.
 */

// Re-export a no-op so any leftover call sites don't crash.
export async function restoreRoutes(): Promise<void> {
    // No-op: routes are resolved at request time by the caddy static_s3 plugin
    // via the `sites` PostgreSQL table. No restoration needed on startup.
    console.log('ℹ️  restoreRoutes: no-op (caddy static_s3 plugin handles routing)')
}
