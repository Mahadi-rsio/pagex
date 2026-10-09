import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    DEPLOYMENT_GC_JOB,
    PAGE_DELETE_JOB,
    parseBackgroundJob,
} from "../src/job";

describe("parseBackgroundJob", () => {
    it("parses a valid deployment_gc job", () => {
        const job = parseBackgroundJob({
            type: "deployment_gc",
            page_id: "page-1",
            site_id: "site-1",
            deployment_id: "dep-1",
        });
        assert.deepEqual(job, {
            type: DEPLOYMENT_GC_JOB,
            page_id: "page-1",
            site_id: "site-1",
            deployment_id: "dep-1",
        });
    });

    it("parses a valid page_delete job", () => {
        const job = parseBackgroundJob({
            type: "page_delete",
            page_id: "page-1",
            site_id: "site-1",
        });
        assert.deepEqual(job, {
            type: PAGE_DELETE_JOB,
            page_id: "page-1",
            site_id: "site-1",
        });
    });

    it("rejects deployment_gc missing deployment_id", () => {
        assert.equal(
            parseBackgroundJob({
                type: "deployment_gc",
                page_id: "page-1",
                site_id: "site-1",
            }),
            null,
        );
    });

    it("rejects page_delete missing site_id", () => {
        assert.equal(
            parseBackgroundJob({ type: "page_delete", page_id: "p" }),
            null,
        );
    });

    it("rejects non-object bodies", () => {
        assert.equal(parseBackgroundJob(null), null);
        assert.equal(parseBackgroundJob("nope"), null);
        assert.equal(parseBackgroundJob(42), null);
        assert.equal(parseBackgroundJob(undefined), null);
    });

    it("rejects unknown job types", () => {
        assert.equal(parseBackgroundJob({ type: "purge_everything" }), null);
    });

    it("rejects non-string discriminants", () => {
        assert.equal(
            parseBackgroundJob({ type: 7, page_id: "p", site_id: "s" }),
            null,
        );
    });
});
