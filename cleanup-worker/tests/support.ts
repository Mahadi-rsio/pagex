import { DEPLOYMENT_RETENTION } from "../src/config";
import type { CleanupRepo } from "../src/repo";

/**
 * In-memory data-backed repo for handler tests. Mirrors the drizzle repo's
 * semantics: retention ordering, cross-page orphan filtering, transaction
 * order, and row removal.
 */
export class MemoryRepo implements CleanupRepo {
    deployments: Array<{
        id: string;
        pageId: string;
        isActive: boolean;
        createdAt: number;
    }> = [];
    entries: Array<{ deploymentId: string; path: string; blobHash: string }> =
        [];
    blobs: Array<{ hash: string; size: number }> = [];
    pages: Array<{
        id: string;
        siteId: string;
        domain: string;
        projectName: string;
        deletedAt: Date | null;
    }> = [];
    sites: Array<{ id: string; subdomain: string; active: boolean }> = [];

    purged: Array<{ deploymentIds: string[]; blobHashes: string[] }> = [];
    hardDeletedPages: string[] = [];

    async findExpiredDeploymentIds(pageId: string): Promise<string[]> {
        const inactive = this.deployments
            .filter((d) => d.pageId === pageId && !d.isActive)
            .sort((a, b) => b.createdAt - a.createdAt);
        return inactive.slice(DEPLOYMENT_RETENTION).map((d) => d.id);
    }

    async findCandidateHashes(
        deploymentIds: readonly string[],
    ): Promise<string[]> {
        return [
            ...new Set(
                this.entries
                    .filter((e) => deploymentIds.includes(e.deploymentId))
                    .map((e) => e.blobHash),
            ),
        ];
    }

    async findStillReferencedHashes(
        candidateHashes: readonly string[],
        excludedDeploymentIds: readonly string[],
    ): Promise<string[]> {
        return [
            ...new Set(
                this.entries
                    .filter(
                        (e) =>
                            candidateHashes.includes(e.blobHash) &&
                            !excludedDeploymentIds.includes(e.deploymentId),
                    )
                    .map((e) => e.blobHash),
            ),
        ];
    }

    async findBlobSizes(
        hashes: readonly string[],
    ): Promise<Array<{ hash: string; size: number }>> {
        return this.blobs
            .filter((b) => hashes.includes(b.hash))
            .map((b) => ({ hash: b.hash, size: b.size }));
    }

    async purgeDeployments(
        deploymentIds: readonly string[],
        deletedBlobHashes: readonly string[],
    ): Promise<void> {
        this.purged.push({
            deploymentIds: [...deploymentIds],
            blobHashes: [...deletedBlobHashes],
        });
        this.deployments = this.deployments.filter(
            (d) => !deploymentIds.includes(d.id),
        );
        this.entries = this.entries.filter(
            (e) => !deploymentIds.includes(e.deploymentId),
        );
        this.blobs = this.blobs.filter(
            (b) => !deletedBlobHashes.includes(b.hash),
        );
    }

    async findPageById(pageId: string) {
        const page = this.pages.find((p) => p.id === pageId);
        return page
            ? {
                  id: page.id,
                  site_id: page.siteId,
                  domain: page.domain,
                  project_name: page.projectName,
                  deletedAt: page.deletedAt,
              }
            : null;
    }

    async findDeploymentsByPage(pageId: string) {
        return this.deployments
            .filter((d) => d.pageId === pageId)
            .map((d) => ({ id: d.id, is_active: d.isActive }));
    }

    async hardDeletePage(pageId: string): Promise<void> {
        this.hardDeletedPages.push(pageId);
        this.pages = this.pages.filter((p) => p.id !== pageId);
    }

    async findSiteById(siteId: string) {
        const site = this.sites.find((s) => s.id === siteId);
        return site ? { subdomain: site.subdomain, active: site.active } : null;
    }
}

/** Minimal R2 bucket fake tracking deletes; can simulate failures. */
export class FakeBucket {
    deleted: string[] = [];
    failAll = false;
    failKeys: Set<string> = new Set();

    async delete(keys: string | string[]): Promise<void> {
        const list = typeof keys === "string" ? [keys] : keys;
        for (const key of list) {
            if (this.failAll || this.failKeys.has(key)) {
                throw new Error(`simulated R2 failure for ${key}`);
            }
            this.deleted.push(key);
        }
    }
}

/** Cast a fake to the R2Bucket interface (only methods used are implemented). */
export function asBucket(fake: FakeBucket): R2Bucket {
    return fake as unknown as R2Bucket;
}

export interface FakeRedis {
    delCalls: string[][];
    del(...keys: string[]): Promise<unknown>;
    pipeline(): unknown;
}

export function makeFakeRedis(): FakeRedis {
    const client: FakeRedis = {
        delCalls: [],
        async del(...keys: string[]): Promise<unknown> {
            client.delCalls.push([...keys]);
            return keys.length;
        },
        pipeline() {
            return undefined;
        },
    };
    return client;
}
