import { and, desc, eq, inArray, notInArray } from "drizzle-orm";
import type { Database } from "./db";
import { DEPLOYMENT_RETENTION } from "./config";
import { blobs, blobTreeEntries, deployments, pages, sites } from "./schema";

export interface PageRef {
    id: string;
    site_id: string;
    domain: string;
    project_name: string;
    deletedAt: Date | null;
}

export interface DeploymentRef {
    id: string;
    is_active: boolean;
}

export interface SiteRef {
    subdomain: string;
    active: boolean;
}

export interface BlobSize {
    hash: string;
    size: number;
}

/**
 * Data-access surface for both cleanup handlers. Handlers only depend on this
 * interface, which keeps them pure and unit-testable with an in-memory fake.
 */
export interface CleanupRepo {
    /** Inactive deployments beyond retention for a page (active is never a target). */
    findExpiredDeploymentIds(pageId: string): Promise<string[]>;
    /** Distinct blob hashes referenced by the given deployments. */
    findCandidateHashes(deploymentIds: readonly string[]): Promise<string[]>;
    /** Hashes still referenced by any deployment outside the excluded set. */
    findStillReferencedHashes(
        candidateHashes: readonly string[],
        excludedDeploymentIds: readonly string[],
    ): Promise<string[]>;
    findBlobSizes(hashes: readonly string[]): Promise<BlobSize[]>;
    /** Delete tree entries → deployments → blobs in one transaction. */
    purgeDeployments(
        deploymentIds: readonly string[],
        deletedBlobHashes: readonly string[],
    ): Promise<void>;
    /** Soft-deleted page record used by the page_delete safety guard. */
    findPageById(pageId: string): Promise<PageRef | null>;
    findDeploymentsByPage(pageId: string): Promise<DeploymentRef[]>;
    hardDeletePage(pageId: string): Promise<void>;
    findSiteById(siteId: string): Promise<SiteRef | null>;
}

export function createRepo(db: Database): CleanupRepo {
    return {
        async findExpiredDeploymentIds(pageId) {
            const rows = await db
                .select({ id: deployments.id })
                .from(deployments)
                .where(
                    and(
                        eq(deployments.page_id, pageId),
                        eq(deployments.is_active, false),
                    ),
                )
                .orderBy(desc(deployments.created_at))
                .offset(DEPLOYMENT_RETENTION);
            return rows.map((r) => r.id);
        },

        async findCandidateHashes(deploymentIds) {
            if (deploymentIds.length === 0) return [];
            const rows = await db
                .selectDistinct({ blobHash: blobTreeEntries.blobHash })
                .from(blobTreeEntries)
                .where(
                    inArray(blobTreeEntries.deploymentId, [...deploymentIds]),
                );
            return rows.map((r) => r.blobHash);
        },

        async findStillReferencedHashes(
            candidateHashes,
            excludedDeploymentIds,
        ) {
            if (candidateHashes.length === 0) return [];
            // With nothing excluded, every candidate is still referenced by one
            // of its own deployments — returning them avoids `NOT IN ()`, which
            // is invalid SQL.
            if (excludedDeploymentIds.length === 0) {
                return [...candidateHashes];
            }
            const rows = await db
                .selectDistinct({ blobHash: blobTreeEntries.blobHash })
                .from(blobTreeEntries)
                .where(
                    and(
                        inArray(blobTreeEntries.blobHash, [...candidateHashes]),
                        notInArray(blobTreeEntries.deploymentId, [
                            ...excludedDeploymentIds,
                        ]),
                    ),
                );
            return rows.map((r) => r.blobHash);
        },

        async findBlobSizes(hashes) {
            if (hashes.length === 0) return [];
            const rows = await db
                .select({ hash: blobs.hash, size: blobs.size })
                .from(blobs)
                .where(inArray(blobs.hash, [...hashes]));
            return rows;
        },

        async purgeDeployments(deploymentIds, deletedBlobHashes) {
            await db.transaction(async (tx) => {
                await tx
                    .delete(blobTreeEntries)
                    .where(
                        inArray(blobTreeEntries.deploymentId, [
                            ...deploymentIds,
                        ]),
                    );
                await tx
                    .delete(deployments)
                    .where(inArray(deployments.id, [...deploymentIds]));
                if (deletedBlobHashes.length > 0) {
                    await tx
                        .delete(blobs)
                        .where(inArray(blobs.hash, [...deletedBlobHashes]));
                }
            });
        },

        async findPageById(pageId) {
            const rows = await db
                .select({
                    id: pages.id,
                    site_id: pages.site_id,
                    domain: pages.domain,
                    project_name: pages.project_name,
                    deletedAt: pages.deletedAt,
                })
                .from(pages)
                .where(eq(pages.id, pageId))
                .limit(1);
            const row = rows[0];
            return row ? { ...row, deletedAt: row.deletedAt ?? null } : null;
        },

        async findDeploymentsByPage(pageId) {
            const rows = await db
                .select({
                    id: deployments.id,
                    is_active: deployments.is_active,
                })
                .from(deployments)
                .where(eq(deployments.page_id, pageId));
            return rows;
        },

        async hardDeletePage(pageId) {
            await db.delete(pages).where(eq(pages.id, pageId));
        },

        async findSiteById(siteId) {
            const rows = await db
                .select({
                    subdomain: sites.subdomain,
                    active: sites.active,
                })
                .from(sites)
                .where(eq(sites.id, siteId))
                .limit(1);
            return rows[0] ?? null;
        },
    };
}
