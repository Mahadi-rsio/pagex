import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeOrphanedHashes } from "../src/handlers/shared";

describe("computeOrphanedHashes", () => {
    it("drops hashes still referenced elsewhere", () => {
        const orphaned = computeOrphanedHashes(["h1", "h2", "h3"], ["h2"]);
        assert.deepEqual(orphaned, ["h1", "h3"]);
    });

    it("keeps nothing when every candidate is still referenced", () => {
        assert.deepEqual(computeOrphanedHashes(["h1", "h2"], ["h1", "h2"]), []);
    });

    it("orphans everything when nothing is still referenced", () => {
        assert.deepEqual(computeOrphanedHashes(["h1", "h2"], []), ["h1", "h2"]);
    });

    it("preserves order and de-duplicates input", () => {
        assert.deepEqual(computeOrphanedHashes(["h2", "h1", "h2"], ["h1"]), [
            "h2",
            "h2",
        ]);
    });
});
