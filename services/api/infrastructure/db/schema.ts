import { bigint, boolean, index, integer, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";


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
});

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
 */
export const blobs = pgTable('blobs', {
    hash: text('hash').primaryKey(),
    size: integer('size').notNull(),
    createdAt: timestamp('created_at').defaultNow(),
});

/**
 * `deployments` — active deployment history (file trees via blob_tree_entries).
 */
export const deployments = pgTable("deployments", {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    page_id: uuid("page_id").notNull().references(() => pages.id, { onDelete: "cascade" }),
    site_id: uuid("site_id").notNull().references(() => sites.id),
    tenant_id: text("tenant_id").notNull(),
    build_id: uuid("build_id").references(() => builds.id),
    version: integer("version").notNull(),
    is_active: boolean("is_active").default(false).notNull(),
    source: text("source").notNull(), // "build" | "upload"
    file_count: integer("file_count").notNull(),
    filesDeployed: integer('files_deployed'),
    filesReused: integer('files_reused'),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

/**
 * `blob_tree_entries` — file tree per deployment (path → blob hash).
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
