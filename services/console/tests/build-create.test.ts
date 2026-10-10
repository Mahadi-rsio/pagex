import { test } from "node:test";
import assert from "node:assert/strict";
import {
    createBuildJob,
    type CreateBuildDeps,
} from "../src/features/builds/build.service";
import type { BuildRow } from "../src/features/builds/build.store";
import { HttpError } from "../src/server/api/utils/http-error";

const PAGE_ID = "123e4567-e89b-12d3-a456-426614174000";
const TENANT_ID = "223e4567-e89b-12d3-a456-426614174000";

function fakeRow(overrides: Partial<BuildRow> = {}): BuildRow {
    return {
        id: "323e4567-e89b-12d3-a456-426614174000",
        page_id: PAGE_ID,
        site_id: "423e4567-e89b-12d3-a456-426614174000",
        tenant_id: TENANT_ID,
        job_id: null,
        status: "queued",
        stage: null,
        repo_url: "https://github.com/owner/repo",
        git_provider: "github",
        branch: "main",
        commit_sha: "abc123",
        commit_message: "msg",
        framework: "auto",
        build_command: "auto",
        output_dir: null,
        error: null,
        triggered_by: "web",
        requested_by: TENANT_ID,
        attempts: 0,
        max_attempts: 2,
        log: "",
        log_bytes: 0,
        log_truncated: false,
        deployment_id: null,
        token_hash: null,
        token_expires_at: null,
        worker_id: null,
        lease_expires_at: null,
        started_at: null,
        updated_at: null,
        created_at: new Date("2024-01-01T00:00:00Z"),
        completed_at: null,
        ...overrides,
    } as BuildRow;
}

interface Recorded {
    inserted?: Parameters<CreateBuildDeps["insert"]>[0];
    woke: boolean;
}

function makeDeps(
    overrides: Partial<CreateBuildDeps>,
    recorded: Recorded,
): CreateBuildDeps {
    return {
        loadOwnedPage: async () => ({
            id: PAGE_ID,
            site_id: "423e4567-e89b-12d3-a456-426614174000",
            tenant_id: TENANT_ID,
            project_name: "proj",
            domain: "proj.example.com",
        }),
        resolveCommit: async () => ({
            sha: "abc123",
            message: "msg",
        }),
        insert: async (values) => {
            recorded.inserted = values;
            return fakeRow({ ...values } as Partial<BuildRow>);
        },
        wake: async () => {
            recorded.woke = true;
            return true;
        },
        ...overrides,
    };
}

test("createBuildJob rejects a page the tenant does not own", async () => {
    const recorded: Recorded = { woke: false };
    const deps = makeDeps({ loadOwnedPage: async () => null }, recorded);
    await assert.rejects(
        () =>
            createBuildJob(
                { pageId: PAGE_ID, repoUrl: "owner/repo" },
                TENANT_ID,
                deps,
            ),
        (err: unknown) => err instanceof HttpError && err.status === 404,
    );
});

test("createBuildJob rejects a non-github repo url", async () => {
    const recorded: Recorded = { woke: false };
    const deps = makeDeps({}, recorded);
    await assert.rejects(
        () =>
            createBuildJob(
                { pageId: PAGE_ID, repoUrl: "https://gitlab.com/o/r" },
                TENANT_ID,
                deps,
            ),
        (err: unknown) => err instanceof HttpError && err.status === 400,
    );
});

test("createBuildJob fails when the branch/commit can't be resolved", async () => {
    const recorded: Recorded = { woke: false };
    const deps = makeDeps({ resolveCommit: async () => null }, recorded);
    await assert.rejects(
        () =>
            createBuildJob(
                { pageId: PAGE_ID, repoUrl: "owner/repo", branch: "nope" },
                TENANT_ID,
                deps,
            ),
        (err: unknown) => err instanceof HttpError && err.status === 400,
    );
});

test("createBuildJob pins the commit, wakes the machine, and defaults branch", async () => {
    const recorded: Recorded = { woke: false };
    const deps = makeDeps(
        {
            resolveCommit: async (_repo, ref) => {
                assert.equal(ref, "main");
                return { sha: "deadbeef", message: "hi" };
            },
        },
        recorded,
    );

    const result = await createBuildJob(
        { pageId: PAGE_ID, repoUrl: "https://github.com/owner/repo" },
        TENANT_ID,
        deps,
    );

    assert.equal(recorded.inserted?.commit_sha, "deadbeef");
    assert.equal(recorded.inserted?.branch, "main");
    assert.equal(recorded.inserted?.status, "queued");
    assert.equal(recorded.inserted?.tenant_id, TENANT_ID);
    assert.equal(recorded.woke, true);
    assert.equal(result.commit_sha, "deadbeef");
    assert.equal(result.status, "queued");
});

test("createBuildJob honours an explicit branch", async () => {
    const recorded: Recorded = { woke: false };
    const deps = makeDeps(
        {
            resolveCommit: async (_repo, ref) => {
                assert.equal(ref, "feature/x");
                return { sha: "cafe", message: "x" };
            },
        },
        recorded,
    );
    await createBuildJob(
        {
            pageId: PAGE_ID,
            repoUrl: "owner/repo",
            branch: "feature/x",
            framework: "vite",
            buildCommand: "npm run build",
            outputDir: "dist",
        },
        TENANT_ID,
        deps,
    );
    assert.equal(recorded.inserted?.branch, "feature/x");
    assert.equal(recorded.inserted?.framework, "vite");
});
