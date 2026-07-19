import { bigint, boolean, date, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";


/**
 * `sites` — one row per deployed project.
 * The caddy static_s3 plugin resolves subdomain → UUID (site_id) by querying
 * this table: SELECT id FROM sites WHERE subdomain = $1 AND active = true
 * The UUID is then used as the S3 key prefix: {site_id}/{filepath}
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
 * `site_id` references sites(id); that UUID is the MinIO prefix.
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
 * `site_daily_stats` — daily analytics written by the caddy static_s3 plugin's
 * analytics middleware. The node app can query this for dashboard stats.
 */
export const siteDailyStats = pgTable("site_daily_stats", {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    site_id: uuid("site_id").notNull().references(() => sites.id, { onDelete: 'cascade' }),
    date: date("date").notNull(),

    requests: bigint("requests", { mode: 'number' }).notNull().default(0),
    bandwidth: bigint("bandwidth", { mode: 'number' }).notNull().default(0),

    requests_2xx: bigint("requests_2xx", { mode: 'number' }).notNull().default(0),
    requests_3xx: bigint("requests_3xx", { mode: 'number' }).notNull().default(0),
    requests_4xx: bigint("requests_4xx", { mode: 'number' }).notNull().default(0),
    requests_5xx: bigint("requests_5xx", { mode: 'number' }).notNull().default(0),

    humans: bigint("humans", { mode: 'number' }).notNull().default(0),
    bots: bigint("bots", { mode: 'number' }).notNull().default(0),
    unique_ips: bigint("unique_ips", { mode: 'number' }).notNull().default(0),

    peak_hour: text("peak_hour"),
    peak_hour_requests: bigint("peak_hour_requests", { mode: 'number' }).notNull().default(0),

    updatedAt: timestamp("updated_at").defaultNow(),
}, (t) => ({
    siteDataIdx: index("idx_site_daily_stats_site_date").on(t.site_id, t.date),
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

