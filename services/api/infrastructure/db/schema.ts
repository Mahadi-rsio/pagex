import { sql } from 'drizzle-orm'
import { bigint, boolean, date, index, integer, pgTable, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";


/**
 * `sites` — one row per deployed project.
 * The caddy static_s3 plugin resolves subdomain → UUID (site_id) by querying
 * this table: SELECT id FROM sites WHERE subdomain = $1 AND active = true
 * The UUID is then used in the S3 key prefix: tenant/{site_id}/{filepath}
 */
export const sites = pgTable("sites", {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    subdomain: text("subdomain").notNull().unique(),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
    subdomainIdx: index("idx_sites_subdomain").on(t.subdomain),
}));

/**
 * `site_daily_stats` — per-site daily analytics written by the Caddy blob-server.
 * Live counters live in Redis as `stats:{site_id}:{YYYY-MM-DD}` and flush here.
 */
export const siteDailyStats = pgTable("site_daily_stats", {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    siteId: uuid("site_id").notNull().references(() => sites.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    requests: bigint("requests", { mode: "number" }).notNull().default(0),
    bandwidth: bigint("bandwidth", { mode: "number" }).notNull().default(0),
    requests2xx: bigint("requests_2xx", { mode: "number" }).notNull().default(0),
    requests3xx: bigint("requests_3xx", { mode: "number" }).notNull().default(0),
    requests4xx: bigint("requests_4xx", { mode: "number" }).notNull().default(0),
    requests5xx: bigint("requests_5xx", { mode: "number" }).notNull().default(0),
    humans: bigint("humans", { mode: "number" }).notNull().default(0),
    bots: bigint("bots", { mode: "number" }).notNull().default(0),
    uniqueIps: bigint("unique_ips", { mode: "number" }).notNull().default(0),
    peakHour: text("peak_hour"),
    peakHourRequests: bigint("peak_hour_requests", { mode: "number" }).notNull().default(0),
    updatedAt: timestamp("updated_at").defaultNow(),
}, (t) => ({
    uniqueSiteDate: unique("site_daily_stats_site_id_date_uid").on(t.siteId, t.date),
    siteDateIdx: index("idx_site_daily_stats_site_date").on(t.siteId, t.date),
}));

/**
 * `pages` — tenant project metadata.
 * `site_id` references sites(id); live files live at tenant/{site_id}/ in MinIO.
 */
export const pages = pgTable("pages", {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    site_id: uuid("site_id").notNull().references(() => sites.id, { onDelete: 'cascade' }),
    tenant_id: text('tenant_id').notNull(),
    tenant_name: text("tenant_name").notNull(),
    plan: text("plan").notNull().default("free"),
    domain: text("domain").notNull(),
    project_name: text('project_name').notNull(),

    request: bigint("request", { mode: 'number' }).notNull().default(0),
    request_limit: bigint("request_limit", { mode: 'number' }).notNull().default(100000),

    bandwidth_usage: bigint("bandwidth_usage", { mode: "number" }).notNull().default(0),

    // 2 GB limit (in bytes)
    bandwidth_limit: bigint("bandwidth_limit", { mode: 'number' })
        .notNull()
        .default(2147483648),

    createdAt: timestamp("createdAt").defaultNow().notNull()
}, (t) => ({
    // Index for tenant-scoped page listing
    tenantIdx: index("idx_pages_tenant").on(t.tenant_id),
    // Index for domain lookups
    domainIdx: index("idx_pages_domain").on(t.domain),
    // Index for project name + tenant lookups
    projectTenantIdx: index("idx_pages_project_tenant").on(t.project_name, t.tenant_id),
}));

/**
 * `builds` — records of page build jobs and their status.
 */
export const builds = pgTable("builds", {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    page_id: uuid("page_id").notNull().references(() => pages.id, { onDelete: "cascade" }),
    tenant_id: text("tenant_id").notNull(),
    job_id: text("job_id"),
    status: text("status").notNull().default("queued"),
    repo_url: text("repo_url").notNull(),
    git_provider: text("git_provider").notNull(),
    framework: text("framework").notNull(),
    build_command: text("build_command").notNull().default("pnpm build"),
    output_dir: text("output_dir"),
    error: text("error"),
    triggered_by: text("triggered_by").notNull().default("cli"),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    completed_at: timestamp("completed_at", { withTimezone: true }),
}, (t) => ({
    buildsPageTenantStatusIdx: index("idx_builds_page_tenant_status").on(t.page_id, t.tenant_id, t.status),
}));

/**
 * `blobs` — content-addressed blob store (SHA256 → MinIO object).
 * Invariant 4: blob hashes are unique (enforced by PRIMARY KEY on hash).
 */
export const blobs = pgTable('blobs', {
    hash: text('hash').primaryKey(),
    size: integer('size').notNull(),
    createdAt: timestamp('created_at').defaultNow(),
});

/**
 * `deployments` — active deployment history (file trees via blob_tree_entries).
 *
 * Invariants enforced at DB level:
 *  - Invariant 1: deployments_page_id_is_active_uid — partial unique index WHERE is_active = true
 *    → only one active deployment per page at any time.
 *  - Invariant 2: deployments_page_id_version_uid — UNIQUE(page_id, version)
 *    → no duplicate version numbers per page.
 *  - Invariant 4b: deployments_build_id_uid — partial unique index WHERE build_id IS NOT NULL
 *    → one deployment per build job (prevents retry double-writes).
 *  - Invariant 5: deployments_active_requires_manifest CHECK
 *    → active deployments must have all manifest fields set.
 */
export const deployments = pgTable("deployments", {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    page_id: uuid("page_id").notNull().references(() => pages.id, { onDelete: "cascade" }),
    site_id: uuid("site_id").notNull().references(() => sites.id),
    tenant_id: text("tenant_id").notNull(),
    build_id: uuid("build_id").references(() => builds.id, { onDelete: "set null" }),
    version: integer("version").notNull(),
    is_active: boolean("is_active").default(false).notNull(),
    status: text("status").notNull().default("pending"), // 'pending' | 'active' | 'failed' | 'superseded'
    source: text("source").notNull(), // "build" | "upload"
    file_count: integer("file_count").notNull(),
    filesDeployed: integer('files_deployed'),
    filesReused: integer('files_reused'),
    /** MinIO object key for the immutable runtime manifest (null until finalized). */
    manifestKey: text('manifest_key'),
    manifestVersion: integer('manifest_version'),
    manifestSize: integer('manifest_size'),
    /** SHA-256 hex of the serialized manifest bytes. */
    manifestHash: text('manifest_hash'),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
    // Index for page + active deployment lookups
    pageActiveIdx: index("idx_deployments_page_active").on(t.page_id, t.is_active),
    // Index for page + tenant + version lookups
    pageTenantVersionIdx: index("idx_deployments_page_tenant_version").on(t.page_id, t.tenant_id, t.version),
    // Index for tenant-scoped deployment listing
    pageTenantIdx: index("idx_deployments_page_tenant").on(t.page_id, t.tenant_id),
    // Index for deployments by build_id
    buildIdIdx: index("idx_deployments_build_id").on(t.build_id),
    // Index for deployments by status
    statusIdx: index("idx_deployments_status").on(t.status),
    // Invariant 2: UNIQUE(page_id, version) — each page has unique version numbers
    uniquePageVersion: unique("deployments_page_id_version_uid").on(t.page_id, t.version),
    // Invariant 1: partial unique index — only one active deployment per page
    // (enforced at DB level; application must deactivate old before activating new)
    uniquePageActive: uniqueIndex("deployments_page_id_is_active_uid")
        .on(t.page_id)
        .where(sql`is_active = true`),
    // Invariant 4b: partial unique index — one deployment per build job
    // (NULL build_id excluded so upload-source deployments are unrestricted)
    uniqueBuildDeployment: uniqueIndex("deployments_build_id_uid")
        .on(t.build_id)
        .where(sql`build_id IS NOT NULL`),
}));

/**
 * `blob_tree_entries` — file tree per deployment (path → blob hash).
 * Invariant 3: uniqueDeploymentPath UNIQUE(deployment_id, path)
 *   → a deployment cannot have two entries for the same path.
 */
export const blobTreeEntries = pgTable('blob_tree_entries', {
    id: uuid('id').primaryKey().defaultRandom(),
    deploymentId: uuid('deployment_id')
        .notNull()
        .references(() => deployments.id, { onDelete: 'cascade' }),
    path: text('path').notNull(),
    blobHash: text('blob_hash')
        .notNull()
        .references(() => blobs.hash),
}, (t) => ({
    uniqueDeploymentPath: unique('blob_tree_entries_deployment_path_uid').on(t.deploymentId, t.path),
    deploymentIdx: index('idx_blob_tree_entries_deployment').on(t.deploymentId),
}));

/**
 * `idempotency_keys` — ensures deployment/build requests are idempotent.
 * Scoped by (tenant_id, page_id, idempotency_key) to allow same key across different pages/tenants.
 *
 * Invariant 7: resource_id and status together encode operation state.
 *   status = 'in_progress', resource_id = NULL  → operation reserved but still running.
 *   status = 'completed',   resource_id = UUID  → operation finished; points to the created resource.
 *   status = 'failed',      resource_id = NULL  → terminal failure; key is blocked from silent re-use.
 *
 * The 'failed' status prevents a race where a concurrent caller that was blocked
 * waiting for INSERT conflict sees the key disappear (via DELETE) and then inserts
 * a fresh reservation — double-executing the operation.
 */
export const idempotencyKeys = pgTable('idempotency_keys', {
    id: uuid('id').primaryKey().defaultRandom(),
    tenant_id: text('tenant_id').notNull(),
    page_id: uuid('page_id').notNull().references(() => pages.id, { onDelete: 'cascade' }),
    idempotency_key: text('idempotency_key').notNull(),
    resource_type: text('resource_type').notNull(), // 'deployment' | 'build'
    // 'in_progress' | 'completed' | 'failed'
    status: text('status').notNull().default('in_progress'),
    // NULL = in progress or failed, UUID = completed (points to created resource)
    resource_id: uuid('resource_id'),
    request_hash: text('request_hash'), // hash of request body for additional safety
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    expires_at: timestamp('expires_at', { withTimezone: true }).notNull(),
}, (t) => ({
    uniqueTenantPageKey: unique('idempotency_keys_tenant_page_key_uid').on(t.tenant_id, t.page_id, t.idempotency_key),
    expiresIdx: index('idx_idempotency_keys_expires').on(t.expires_at),
    tenantPageIdx: index('idx_idempotency_keys_tenant_page').on(t.tenant_id, t.page_id),
    resourceIdx: index('idx_idempotency_keys_resource').on(t.resource_type, t.resource_id),
    statusIdx: index('idx_idempotency_keys_status').on(t.status),
}));

/**
 * `build_failures` — durable failure records written by the DLQ worker when a
 * build job exhausts all BullMQ retries. This table must NEVER contain secrets
 * (no env_vars, no tokens, no passwords).
 */
export const buildFailures = pgTable('build_failures', {
    id: uuid('id').primaryKey().defaultRandom().notNull(),
    original_job_id: text('original_job_id').notNull(),
    queue_name: text('queue_name').notNull(),
    tenant_id: text('tenant_id').notNull(),
    page_id: uuid('page_id').notNull().references(() => pages.id, { onDelete: 'cascade' }),
    build_id: uuid('build_id').references(() => builds.id, { onDelete: 'set null' }),
    deployment_id: uuid('deployment_id').references(() => deployments.id, { onDelete: 'set null' }),
    attempts: integer('attempts').notNull().default(0),
    error_type: text('error_type').notNull(), // 'permanent' | 'unknown'
    error_message: text('error_message').notNull(),
    failed_at: timestamp('failed_at', { withTimezone: true }).notNull().defaultNow(),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
    pageIdx: index('idx_build_failures_page_id').on(t.page_id),
    buildIdx: index('idx_build_failures_build_id').on(t.build_id),
    failedAtIdx: index('idx_build_failures_failed_at').on(t.failed_at),
}));


