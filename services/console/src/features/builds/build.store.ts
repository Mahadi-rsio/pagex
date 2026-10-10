import { and, desc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "@/server/api/infrastructure/db/db";
import {
    buildFailures,
    builds,
    deployments,
    pages,
} from "@/server/api/infrastructure/db/schema";
import { withLivePage } from "@/server/api/utils/page-visibility";
import type { BuildStage, BuildStatus } from "./build-policy";

/**
 * Persistence for the remote build system. All authoritative job state lives in
 * the `builds` table; the queue and the Fly machine are best-effort signals and
 * workers respectively.
 */

export type BuildRow = typeof builds.$inferSelect;
export type BuildInsert = typeof builds.$inferInsert;

export interface BuildTokenRecord {
    id: string;
    page_id: string;
    tenant_id: string;
    status: string;
    token_hash: string | null;
    token_expires_at: Date | null;
}

/** Load only the fields needed to verify a build job token. */
export async function loadBuildTokenRecord(
    buildId: string,
): Promise<BuildTokenRecord | null> {
    const rows = await db
        .select({
            id: builds.id,
            page_id: builds.page_id,
            tenant_id: builds.tenant_id,
            status: builds.status,
            token_hash: builds.token_hash,
            token_expires_at: builds.token_expires_at,
        })
        .from(builds)
        .where(eq(builds.id, buildId))
        .limit(1);
    return rows[0] ?? null;
}

/** A build scoped to its owning tenant (returns null for cross-tenant reads). */
export async function loadBuildForTenant(
    buildId: string,
    tenantId: string,
): Promise<BuildRow | null> {
    const rows = await db
        .select()
        .from(builds)
        .where(and(eq(builds.id, buildId), eq(builds.tenant_id, tenantId)))
        .limit(1);
    return rows[0] ?? null;
}

export async function loadBuildById(buildId: string): Promise<BuildRow | null> {
    const rows = await db
        .select()
        .from(builds)
        .where(eq(builds.id, buildId))
        .limit(1);
    return rows[0] ?? null;
}

export interface PageRef {
    id: string;
    site_id: string;
    tenant_id: string;
    project_name: string;
    domain: string;
}

/** Load a live (non soft-deleted) page owned by the tenant. */
export async function loadOwnedPage(
    pageId: string,
    tenantId: string,
): Promise<PageRef | null> {
    const rows = await db
        .select({
            id: pages.id,
            site_id: pages.site_id,
            tenant_id: pages.tenant_id,
            project_name: pages.project_name,
            domain: pages.domain,
        })
        .from(pages)
        .where(
            withLivePage(eq(pages.id, pageId), eq(pages.tenant_id, tenantId)),
        )
        .limit(1);
    return rows[0] ?? null;
}

export async function listBuildsForPage(
    pageId: string,
    tenantId: string,
    limit = 20,
): Promise<BuildRow[]> {
    return db
        .select()
        .from(builds)
        .where(and(eq(builds.page_id, pageId), eq(builds.tenant_id, tenantId)))
        .orderBy(desc(builds.created_at))
        .limit(limit);
}

export async function insertBuild(values: BuildInsert): Promise<BuildRow> {
    const rows = await db.insert(builds).values(values).returning();
    const row = rows[0];
    if (!row) throw new Error("failed to insert build row");
    return row;
}

/**
 * Atomically claim the oldest queued job for a single worker.
 *
 * `FOR UPDATE SKIP LOCKED` guarantees two machines racing the same queue never
 * claim the same row. The claim also mints the job token details and bumps the
 * attempt counter, so a crash after this point is observable via the lease.
 */
export async function claimNextBuild(params: {
    workerId: string;
    tokenHash: string;
    tokenExpiresAt: Date;
    leaseExpiresAt: Date;
}): Promise<BuildRow | null> {
    const result = (await db.execute(sql`
        UPDATE ${builds}
        SET
            status = 'active',
            stage = 'cloning',
            worker_id = ${params.workerId},
            token_hash = ${params.tokenHash},
            token_expires_at = ${params.tokenExpiresAt},
            lease_expires_at = ${params.leaseExpiresAt},
            started_at = now(),
            updated_at = now(),
            attempts = ${builds.attempts} + 1
        WHERE id = (
            SELECT id FROM ${builds}
            WHERE status = 'queued'
            ORDER BY created_at ASC
            LIMIT 1
            FOR UPDATE SKIP LOCKED
        )
        RETURNING *
    `)) as unknown as { rows: BuildRow[] };

    return result.rows[0] ?? null;
}

export async function setBuildStage(
    buildId: string,
    stage: BuildStage,
): Promise<void> {
    await db
        .update(builds)
        .set({ stage, updated_at: new Date() })
        .where(eq(builds.id, buildId));
}

export async function updateBuildLog(
    buildId: string,
    log: string,
    logBytes: number,
    truncated: boolean,
    stage?: BuildStage,
): Promise<void> {
    await db
        .update(builds)
        .set({
            log,
            log_bytes: logBytes,
            log_truncated: truncated,
            updated_at: new Date(),
            ...(stage ? { stage } : {}),
        })
        .where(eq(builds.id, buildId));
}

/** Refresh the lease for an in-flight job. Only the owning worker may renew. */
export async function heartbeatBuild(
    buildId: string,
    workerId: string,
    leaseExpiresAt: Date,
): Promise<boolean> {
    const rows = await db
        .update(builds)
        .set({ lease_expires_at: leaseExpiresAt, updated_at: new Date() })
        .where(
            and(
                eq(builds.id, buildId),
                eq(builds.worker_id, workerId),
                eq(builds.status, "active"),
            ),
        )
        .returning({ id: builds.id });
    return rows.length > 0;
}

/** Mark a job terminal. Never touches deployments — a failed build leaves the
 * previously active deployment untouched. */
export async function finishBuild(params: {
    buildId: string;
    status: Extract<BuildStatus, "completed" | "failed" | "cancelled">;
    deploymentId?: string | null;
    error?: string | null;
    stage?: BuildStage;
}): Promise<BuildRow | null> {
    const rows = await db
        .update(builds)
        .set({
            status: params.status,
            error: params.error ?? null,
            deployment_id: params.deploymentId ?? null,
            ...(params.stage ? { stage: params.stage } : {}),
            completed_at: new Date(),
            updated_at: new Date(),
        })
        .where(
            and(
                eq(builds.id, params.buildId),
                inArray(builds.status, ["active", "queued"]),
            ),
        )
        .returning();
    return rows[0] ?? null;
}

/**
 * Requeue an expired `active` job so another worker (or a restarted machine)
 * can pick it up. Clears the stale worker/token so the old credential is dead.
 */
export async function requeueBuild(buildId: string): Promise<boolean> {
    const rows = await db
        .update(builds)
        .set({
            status: "queued",
            stage: null,
            worker_id: null,
            token_hash: null,
            token_expires_at: null,
            lease_expires_at: null,
            started_at: null,
            updated_at: new Date(),
        })
        .where(and(eq(builds.id, buildId), eq(builds.status, "active")))
        .returning({ id: builds.id });
    return rows.length > 0;
}

export interface StaleBuild {
    id: string;
    page_id: string;
    attempts: number;
    max_attempts: number;
    lease_expires_at: Date | null;
}

export async function listStaleActiveBuilds(
    now: Date,
    limit = 50,
): Promise<StaleBuild[]> {
    return db
        .select({
            id: builds.id,
            page_id: builds.page_id,
            attempts: builds.attempts,
            max_attempts: builds.max_attempts,
            lease_expires_at: builds.lease_expires_at,
        })
        .from(builds)
        .where(
            and(
                eq(builds.status, "active"),
                or(
                    isNull(builds.lease_expires_at),
                    lt(builds.lease_expires_at, now),
                ),
            ),
        )
        .limit(limit);
}

/** Count jobs in the given statuses (used by the machine controller). */
export async function countBuildsByStatus(
    statuses: BuildStatus[],
): Promise<number> {
    const rows = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(builds)
        .where(inArray(builds.status, statuses));
    return rows[0]?.count ?? 0;
}

/**
 * Confirm a deployment was actually produced by the given build for the given
 * page. This is the server-side guard that stops a machine (or a stolen job
 * token) from linking a cross-project deployment to a build.
 */
export async function isDeploymentOfBuild(
    deploymentId: string,
    buildId: string,
    pageId: string,
): Promise<boolean> {
    const rows = await db
        .select({ id: deployments.id })
        .from(deployments)
        .where(
            and(
                eq(deployments.id, deploymentId),
                eq(deployments.build_id, buildId),
                eq(deployments.page_id, pageId),
            ),
        )
        .limit(1);
    return rows.length > 0;
}

/** Record a permanent build failure for observability (mirrors the queue). */
export async function insertBuildFailure(values: {
    original_job_id: string;
    queue_name: string;
    tenant_id: string;
    page_id: string;
    build_id: string;
    attempts: number;
    error_type: "permanent" | "unknown";
    error_message: string;
}): Promise<void> {
    await db.insert(buildFailures).values(values);
}
