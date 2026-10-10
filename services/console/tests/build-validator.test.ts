import { test } from "node:test";
import assert from "node:assert/strict";
import {
    createBuildSchema,
    parseRepoUrl,
} from "../src/features/builds/build.validator";

test("parseRepoUrl accepts https and shorthand github urls", () => {
    const https = parseRepoUrl("https://github.com/owner/repo");
    assert.equal(https?.owner, "owner");
    assert.equal(https?.repo, "repo");
    assert.equal(https?.cloneUrl, "https://github.com/owner/repo.git");

    const dotGit = parseRepoUrl("https://github.com/owner/repo.git");
    assert.equal(dotGit?.repo, "repo");

    const shorthand = parseRepoUrl("owner/repo");
    assert.equal(shorthand?.url, "https://github.com/owner/repo");
});

test("parseRepoUrl rejects unsafe or non-github urls", () => {
    assert.equal(parseRepoUrl("https://user:pass@github.com/o/r"), null);
    assert.equal(parseRepoUrl("git@github.com:owner/repo.git"), null);
    assert.equal(parseRepoUrl("https://gitlab.com/owner/repo"), null);
    assert.equal(parseRepoUrl("ssh://github.com/o/r"), null);
    assert.equal(parseRepoUrl(""), null);
});

test("createBuildSchema accepts a minimal payload", () => {
    const parsed = createBuildSchema.safeParse({
        pageId: "123e4567-e89b-12d3-a456-426614174000",
        repoUrl: "https://github.com/owner/repo",
    });
    assert.equal(parsed.success, true);
});

test("createBuildSchema accepts a branch", () => {
    const parsed = createBuildSchema.safeParse({
        pageId: "123e4567-e89b-12d3-a456-426614174000",
        repoUrl: "owner/repo",
        branch: "feature/foo",
    });
    assert.equal(parsed.success, true);
});

test("createBuildSchema rejects a leading-dash branch", () => {
    const parsed = createBuildSchema.safeParse({
        pageId: "123e4567-e89b-12d3-a456-426614174000",
        repoUrl: "owner/repo",
        branch: "-evil",
    });
    assert.equal(parsed.success, false);
});

test("createBuildSchema rejects a non-https repo url", () => {
    const parsed = createBuildSchema.safeParse({
        pageId: "123e4567-e89b-12d3-a456-426614174000",
        repoUrl: "http://github.com/owner/repo",
    });
    assert.equal(parsed.success, false);
});

test("createBuildSchema rejects an absolute output dir", () => {
    const parsed = createBuildSchema.safeParse({
        pageId: "123e4567-e89b-12d3-a456-426614174000",
        repoUrl: "owner/repo",
        outputDir: "/etc",
    });
    assert.equal(parsed.success, false);
});
