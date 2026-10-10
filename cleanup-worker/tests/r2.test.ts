import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { blobObjectKey, manifestObjectKey } from "../src/config";
import { deleteBlobObjects, deleteManifestObjects } from "../src/r2";
import { asBucket, FakeBucket } from "./support";

describe("object keys", () => {
    it("builds blob keys under blobs/", () => {
        assert.equal(blobObjectKey("abc123"), "blobs/abc123");
    });

    it("builds manifest keys under manifests/", () => {
        assert.equal(
            manifestObjectKey("dep-9"),
            "manifests/dep-9.manifest.json",
        );
    });
});

describe("deleteBlobObjects", () => {
    it("returns only hashes whose delete succeeded", async () => {
        const bucket = new FakeBucket();
        bucket.failKeys.add(blobObjectKey("h2"));

        const deleted = await deleteBlobObjects(asBucket(bucket), [
            "h1",
            "h2",
            "h3",
        ]);

        assert.deepEqual(deleted, ["h1", "h3"]);
        assert.deepEqual([...new Set(bucket.deleted)].sort(), [
            "blobs/h1",
            "blobs/h3",
        ]);
    });

    it("returns [] for empty input and never touches the bucket", async () => {
        const bucket = new FakeBucket();
        const deleted = await deleteBlobObjects(asBucket(bucket), []);
        assert.deepEqual(deleted, []);
        assert.deepEqual(bucket.deleted, []);
    });
});

describe("deleteManifestObjects", () => {
    it("deletes manifest objects for deployments", async () => {
        const bucket = new FakeBucket();
        const deleted = await deleteManifestObjects(asBucket(bucket), [
            "dep-1",
            "dep-2",
        ]);
        assert.deepEqual(deleted, ["dep-1", "dep-2"]);
        assert.deepEqual(bucket.deleted, [
            "manifests/dep-1.manifest.json",
            "manifests/dep-2.manifest.json",
        ]);
    });
});
