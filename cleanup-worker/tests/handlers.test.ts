import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runDeploymentGC } from "../src/handlers/deployment-gc";
import { runPageDelete } from "../src/handlers/page-delete";
import { asBucket, FakeBucket, makeFakeRedis, MemoryRepo } from "./support";

function deploymentRef(id: string, isActive: boolean) {
    return { id, isActive };
}

describe("runDeploymentGC", () => {
    it("deletes orphaned blobs + manifests and purges only expired deployments", async () => {
        const repo = new MemoryRepo();
        repo.deployments = [
            deploymentRef("d1", false),
            deploymentRef("d2", false),
        ].map((d, i) => ({ ...d, pageId: "page-1", createdAt: i }));
        repo.entries = [
            { deploymentId: "d1", path: "index.html", blobHash: "h1" },
            { deploymentId: "d1", path: "app.js", blobHash: "h2" },
            { deploymentId: "d2", path: "index.html", blobHash: "h3" },
            // h2 is shared with a non-expired deployment — must survive
            { deploymentId: "d-live", path: "app.js", blobHash: "h2" },
        ];
        repo.blobs = [
            { hash: "h1", size: 10 },
            { hash: "h2", size: 20 },
            { hash: "h3", size: 30 },
        ];
        const bucket = new FakeBucket();

        // Force d1+d2 to be "expired" regardless of retention count.
        repo.findExpiredDeploymentIds = async (pageId: string) =>
            pageId === "page-1" ? ["d1", "d2"] : [];

        const result = await runDeploymentGC(
            {
                type: "deployment_gc",
                page_id: "page-1",
                site_id: "site-1",
                deployment_id: "d2",
            },
            { repo, bucket: asBucket(bucket) },
        );

        assert.equal(result.outcome, "completed");
        // h2 shared with d-live is protected; h1+h3 orphaned and deleted.
        assert.deepEqual(
            bucket.deleted.sort(),
            [
                "blobs/h1",
                "blobs/h3",
                "manifests/d1.manifest.json",
                "manifests/d2.manifest.json",
            ].sort(),
        );
        assert.deepEqual(repo.purged, [
            { deploymentIds: ["d1", "d2"], blobHashes: ["h1", "h3"] },
        ]);
    });

    it("skips when there are no expired deployments", async () => {
        const repo = new MemoryRepo();
        const bucket = new FakeBucket();

        const result = await runDeploymentGC(
            {
                type: "deployment_gc",
                page_id: "page-1",
                site_id: "site-1",
                deployment_id: "d1",
            },
            { repo, bucket: asBucket(bucket) },
        );

        assert.equal(result.outcome, "skipped");
        assert.deepEqual(bucket.deleted, []);
        assert.deepEqual(repo.purged, []);
    });

    it("only purges blob rows whose R2 delete succeeded", async () => {
        const repo = new MemoryRepo();
        repo.deployments = [deploymentRef("d1", false)].map((d) => ({
            ...d,
            pageId: "page-1",
            createdAt: 0,
        }));
        repo.entries = [
            { deploymentId: "d1", path: "a", blobHash: "h1" },
            { deploymentId: "d1", path: "b", blobHash: "h2" },
        ];
        repo.blobs = [
            { hash: "h1", size: 10 },
            { hash: "h2", size: 20 },
        ];
        const bucket = new FakeBucket();
        bucket.failKeys.add("blobs/h1");
        repo.findExpiredDeploymentIds = async () => ["d1"];

        const result = await runDeploymentGC(
            {
                type: "deployment_gc",
                page_id: "page-1",
                site_id: "site-1",
                deployment_id: "d1",
            },
            { repo, bucket: asBucket(bucket) },
        );

        assert.equal(result.outcome, "completed");
        assert.deepEqual(repo.purged, [
            { deploymentIds: ["d1"], blobHashes: ["h2"] },
        ]);
    });
});

describe("runPageDelete", () => {
    function pageRef(
        overrides: Partial<{
            id: string;
            siteId: string;
            domain: string;
            projectName: string;
            deletedAt: Date | null;
        }> = {},
    ) {
        return {
            id: "page-1",
            siteId: "site-1",
            domain: "example.com",
            projectName: "acme",
            deletedAt: new Date("2026-01-01T00:00:00Z"),
            ...overrides,
        };
    }

    it("purges the page: blobs (cross-page safe), manifests, DB rows, cache, page row", async () => {
        const repo = new MemoryRepo();
        repo.pages = [pageRef()];
        repo.sites = [{ id: "site-1", subdomain: "acme", active: false }];
        repo.deployments = [deploymentRef("d1", false)].map((d) => ({
            ...d,
            pageId: "page-1",
            createdAt: 0,
        }));
        repo.entries = [
            { deploymentId: "d1", path: "a", blobHash: "h1" },
            { deploymentId: "d1", path: "b", blobHash: "h2" },
        ];
        // h2 is shared with ANOTHER page's deployment — must survive the purge.
        repo.entries.push({
            deploymentId: "d-other",
            path: "b",
            blobHash: "h2",
        });
        repo.blobs = [
            { hash: "h1", size: 1 },
            { hash: "h2", size: 2 },
        ];
        const bucket = new FakeBucket();
        const redis = makeFakeRedis();

        const result = await runPageDelete(
            { type: "page_delete", page_id: "page-1", site_id: "site-1" },
            { repo, bucket: asBucket(bucket), redis, redisPrefix: "px" },
        );

        assert.equal(result.outcome, "completed");
        // h1 orphaned (deleted), h2 shared (kept)
        assert.deepEqual(
            bucket.deleted.sort(),
            ["blobs/h1", "manifests/d1.manifest.json"].sort(),
        );
        assert.deepEqual(repo.purged, [
            { deploymentIds: ["d1"], blobHashes: ["h1"] },
        ]);
        assert.deepEqual(repo.hardDeletedPages, ["page-1"]);
        assert.deepEqual(repo.pages, []);
        // Redis sweep covers routing + runtime + deployment manifest keys
        const delKeys = redis.delCalls.flat();
        for (const expected of [
            "px:site:subdomain:acme",
            "px:site:site-1:active",
            "px:site_files:site-1",
            "px:site_version:site-1",
            "px:db_cache:example.com",
            "px:requests:example.com",
            "px:bandwidth:example.com",
            "px:manifest:d1",
        ]) {
            assert.ok(delKeys.includes(expected), `missing key ${expected}`);
        }
    });

    it("skips (idempotent) when the page row is already gone", async () => {
        const repo = new MemoryRepo();
        const bucket = new FakeBucket();
        const result = await runPageDelete(
            { type: "page_delete", page_id: "page-1", site_id: "site-1" },
            { repo, bucket: asBucket(bucket), redis: null, redisPrefix: "px" },
        );
        assert.equal(result.outcome, "skipped");
        assert.deepEqual(bucket.deleted, []);
        assert.deepEqual(repo.hardDeletedPages, []);
    });

    it("refuses to purge a live (not soft-deleted) page", async () => {
        const repo = new MemoryRepo();
        repo.pages = [pageRef({ deletedAt: null })];
        repo.deployments = [deploymentRef("d1", false)].map((d) => ({
            ...d,
            pageId: "page-1",
            createdAt: 0,
        }));
        const bucket = new FakeBucket();

        const result = await runPageDelete(
            { type: "page_delete", page_id: "page-1", site_id: "site-1" },
            { repo, bucket: asBucket(bucket), redis: null, redisPrefix: "px" },
        );

        assert.equal(result.outcome, "permanent-error");
        assert.deepEqual(bucket.deleted, []);
        assert.deepEqual(repo.hardDeletedPages, []);
        assert.deepEqual(repo.purged, []);
    });

    it("purges despite a stale is_active flag on a deployment", async () => {
        const repo = new MemoryRepo();
        repo.pages = [pageRef()];
        repo.sites = [{ id: "site-1", subdomain: "acme", active: false }];
        // The console never clears is_active on delete, so a soft-deleted page
        // commonly still has a deployment flagged active.
        repo.deployments = [deploymentRef("d1", true)].map((d) => ({
            ...d,
            pageId: "page-1",
            createdAt: 0,
        }));
        repo.entries = [{ deploymentId: "d1", path: "a", blobHash: "h1" }];
        repo.blobs = [{ hash: "h1", size: 1 }];
        const bucket = new FakeBucket();

        const result = await runPageDelete(
            { type: "page_delete", page_id: "page-1", site_id: "site-1" },
            { repo, bucket: asBucket(bucket), redis: null, redisPrefix: "px" },
        );

        assert.equal(result.outcome, "completed");
        assert.deepEqual(
            bucket.deleted.sort(),
            ["blobs/h1", "manifests/d1.manifest.json"].sort(),
        );
        assert.deepEqual(repo.hardDeletedPages, ["page-1"]);
    });

    it("tolerates a missing site row (falls back to project_name)", async () => {
        const repo = new MemoryRepo();
        repo.pages = [pageRef()];
        repo.deployments = [];
        const bucket = new FakeBucket();
        const redis = makeFakeRedis();

        const result = await runPageDelete(
            { type: "page_delete", page_id: "page-1", site_id: "site-1" },
            { repo, bucket: asBucket(bucket), redis, redisPrefix: "px" },
        );

        assert.equal(result.outcome, "completed");
        assert.deepEqual(
            redis.delCalls.flat().filter((k) => k.includes("site:subdomain")),
            ["px:site:subdomain:acme"],
        );
        assert.deepEqual(repo.hardDeletedPages, ["page-1"]);
    });
});
