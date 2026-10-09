import { sql } from "drizzle-orm";
import {
    bigint,
    boolean,
    index,
    integer,
    pgTable,
    text,
    timestamp,
    unique,
    uniqueIndex,
    uuid,
} from "drizzle-orm/pg-core";

/**
 * Drizzle schema subset used by the cleanup worker.
 *
 * Definitions are copied verbatim (column names and modes) from
 * `services/console/src/modules/api/schemas/api.schema.ts` and the applied
 * migrations in `services/console/drizzle-api/`. Only the tables and indexes
 * this worker reads/writes are declared here; the DB is fully migrated by the
 * console, this worker never creates or alters schema.
 */

/** Minimal `builds` declaration so `deployments.build_id` can reference it. */
export const builds = pgTable("builds", {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
});

export const sites = pgTable(
    "sites",
    {
        id: uuid("id").primaryKey().notNull().defaultRandom(),
        subdomain: text("subdomain").notNull().unique(),
        active: boolean("active").notNull().default(true),
        createdAt: timestamp("created_at").defaultNow().notNull(),
    },
    (t) => ({
        subdomainIdx: index("idx_sites_subdomain").on(t.subdomain),
    }),
);

export const pages = pgTable(
    "pages",
    {
        id: uuid("id").primaryKey().notNull().defaultRandom(),
        site_id: uuid("site_id")
            .notNull()
            .references(() => sites.id, { onDelete: "cascade" }),
        tenant_id: text("tenant_id").notNull(),
        tenant_name: text("tenant_name").notNull(),
        plan: text("plan").notNull().default("free"),
        domain: text("domain").notNull(),
        project_name: text("project_name").notNull(),
        request: bigint("request", { mode: "number" }).notNull().default(0),
        request_limit: bigint("request_limit", { mode: "number" })
            .notNull()
            .default(100000),
        bandwidth_usage: bigint("bandwidth_usage", { mode: "number" })
            .notNull()
            .default(0),
        bandwidth_limit: bigint("bandwidth_limit", { mode: "number" })
            .notNull()
            .default(2147483648),
        createdAt: timestamp("createdAt").defaultNow().notNull(),
        /** Set by the soft delete; NULL while the project exists. */
        deletedAt: timestamp("deleted_at", { withTimezone: true }),
    },
    (t) => ({
        tenantIdx: index("idx_pages_tenant").on(t.tenant_id),
        domainIdx: index("idx_pages_domain").on(t.domain),
        projectTenantIdx: index("idx_pages_project_tenant").on(
            t.project_name,
            t.tenant_id,
        ),
        siteIdx: index("idx_pages_site").on(t.site_id),
    }),
);

export const blobs = pgTable("blobs", {
    hash: text("hash").primaryKey(),
    size: integer("size").notNull(),
    createdAt: timestamp("created_at").defaultNow(),
});

export const deployments = pgTable(
    "deployments",
    {
        id: uuid("id").primaryKey().notNull().defaultRandom(),
        page_id: uuid("page_id")
            .notNull()
            .references(() => pages.id, { onDelete: "cascade" }),
        site_id: uuid("site_id")
            .notNull()
            .references(() => sites.id),
        tenant_id: text("tenant_id").notNull(),
        build_id: uuid("build_id").references(() => builds.id, {
            onDelete: "set null",
        }),
        version: integer("version").notNull(),
        is_active: boolean("is_active").default(false).notNull(),
        status: text("status").notNull().default("pending"),
        source: text("source").notNull(),
        file_count: integer("file_count").notNull(),
        filesDeployed: integer("files_deployed"),
        filesReused: integer("files_reused"),
        manifestKey: text("manifest_key"),
        manifestVersion: integer("manifest_version"),
        manifestSize: integer("manifest_size"),
        manifestHash: text("manifest_hash"),
        created_at: timestamp("created_at", { withTimezone: true })
            .defaultNow()
            .notNull(),
    },
    (t) => ({
        pageActiveIdx: index("idx_deployments_page_active").on(
            t.page_id,
            t.is_active,
        ),
        pageTenantVersionIdx: index("idx_deployments_page_tenant_version").on(
            t.page_id,
            t.tenant_id,
            t.version,
        ),
        pageTenantIdx: index("idx_deployments_page_tenant").on(
            t.page_id,
            t.tenant_id,
        ),
        buildIdIdx: index("idx_deployments_build_id").on(t.build_id),
        statusIdx: index("idx_deployments_status").on(t.status),
        uniquePageVersion: unique("deployments_page_id_version_uid").on(
            t.page_id,
            t.version,
        ),
        uniquePageActive: uniqueIndex("deployments_page_id_is_active_uid")
            .on(t.page_id)
            .where(sql`is_active = true`),
        uniqueBuildDeployment: uniqueIndex("deployments_build_id_uid")
            .on(t.build_id)
            .where(sql`build_id IS NOT NULL`),
    }),
);

export const blobTreeEntries = pgTable(
    "blob_tree_entries",
    {
        id: uuid("id").primaryKey().defaultRandom(),
        deploymentId: uuid("deployment_id")
            .notNull()
            .references(() => deployments.id, { onDelete: "cascade" }),
        path: text("path").notNull(),
        blobHash: text("blob_hash")
            .notNull()
            .references(() => blobs.hash),
    },
    (t) => ({
        uniqueDeploymentPath: unique(
            "blob_tree_entries_deployment_path_uid",
        ).on(t.deploymentId, t.path),
        deploymentIdx: index("idx_blob_tree_entries_deployment").on(
            t.deploymentId,
        ),
    }),
);
