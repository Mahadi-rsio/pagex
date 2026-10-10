import {
    BUILD_JOB_TOKEN_TTL_SECONDS,
    BUILD_LEASE_SECONDS,
    BUILD_MAX_ATTEMPTS,
    MAX_BUILD_LOG_BYTES,
} from "@/server/api/constants";
import { redis, redisKey } from "@/server/api/infrastructure/cache/redis";
import { HttpError } from "@/server/api/utils/http-error";
import {
    boundedLogAppend,
    decideStaleReclaim,
    isTerminalStatus,
    redactSecrets,
    sanitizeError,
} from "./build-policy";
import * as store from "./build.store";
import type { CompleteBuildInput, CreateBuildInput } from "./build.validator";
import { parseRepoUrl } from "./build.validator";
import {
    type GithubCommit,
    resolveCommit as defaultResolveCommit,
} from "./github.service";
import {
    formatJobToken,
    generateJobSecret,
    hashJobSecret,
} from "./job-token.service";

/**
 * Remote build orchestration. This is the single place that mutates build job
 * state; the queue only carries wake signals and the machine only calls back
 * through the authenticated job endpoints.
 *
 * The create path is dependency-injected so the security-critical decisions
 * (ownership, repo validation, commit pinning) are unit-testable.
 */

export interface BuildResponse {
    id: string;
    page_id: string;
    tenant_id: string;
    job_id: string | null;
    status: string;
    stage: string | null;
    repo_url: string;
    git_provider: string;
    branch: string;
    commit_sha: string | null;
    commit_message: string | null;
    framework: string;
    build_command: string | null;
    output_dir: string | null;
    error: string | null;
    triggered_by: string;
    deployment_id: string | null;
    created_at: string;
    started_at: string | null;
    completed_at: string | null;
}

/**
 * Raw SQL (`RETURNING *`) returns timestamps as ISO strings on the Worker's
 * Neon/Hyperdrive driver, whereas Drizzle-mapped selects return `Date`. Accept
 * both so `toApiBuild` is safe regardless of how the row was loaded.
 */
function iso(value: Date | string | null | undefined): string | null {
    if (!value) return null;
    return value instanceof Date
        ? value.toISOString()
        : new Date(value).toISOString();
}

/** Shape returned to the dashboard / polling clients. */
export function toApiBuild(row: store.BuildRow): BuildResponse {
    return {
        id: row.id,
        page_id: row.page_id,
        tenant_id: row.tenant_id,
        job_id: row.job_id,
        status: row.status,
        stage: row.stage,
        repo_url: row.repo_url,
        git_provider: row.git_provider,
        branch: row.branch,
        commit_sha: row.commit_sha,
        commit_message: row.commit_message,
        framework: row.framework,
        build_command: row.build_command,
        output_dir: row.output_dir,
        error: row.error,
        triggered_by: row.triggered_by,
        deployment_id: row.deployment_id,
        created_at: iso(row.created_at) ?? "",
        started_at: iso(row.started_at),
        completed_at: iso(row.completed_at),
    };
}

export interface CreateBuildDeps {
    loadOwnedPage: typeof store.loadOwnedPage;
    resolveCommit: (
        repo: ReturnType<typeof parseRepoUrl> & object,
        ref: string,
    ) => Promise<GithubCommit | null>;
    insert: typeof store.insertBuild;
    /** Best-effort immediate wake of the shared build machine. */
    wake: () => Promise<boolean>;
}

async function defaultCreateDeps(): Promise<CreateBuildDeps> {
    const { wakeBuildMachine } = await import("./fly.controller");
    return {
        loadOwnedPage: store.loadOwnedPage,
        resolveCommit: (repo, ref) => defaultResolveCommit(fetch, repo, ref),
        insert: store.insertBuild,
        wake: () => wakeBuildMachine(),
    };
}

export async function createBuildJob(
    input: CreateBuildInput,
    tenantId: string,
    deps?: CreateBuildDeps,
): Promise<BuildResponse> {
    const d = deps ?? (await defaultCreateDeps());

    const page = await d.loadOwnedPage(input.pageId, tenantId);
    if (!page) {
        throw new HttpError("Project not found", 404);
    }

    const repo = parseRepoUrl(input.repoUrl);
    if (!repo) {
        throw new HttpError("repoUrl must be a public GitHub repository", 400);
    }

    const ref = input.branch ?? "main";
    const commit = await d.resolveCommit(repo, ref);
    if (!commit) {
        throw new HttpError(`Repository or branch "${ref}" not found`, 400);
    }

    const row = await d.insert({
        page_id: page.id,
        site_id: page.site_id,
        tenant_id: tenantId,
        status: "queued",
        repo_url: repo.url,
        git_provider: repo.provider,
        branch: ref,
        commit_sha: commit.sha,
        commit_message: commit.message,
        framework: input.framework ?? "auto",
        build_command: input.buildCommand ?? "auto",
        output_dir: input.outputDir ?? null,
        requested_by: tenantId,
        triggered_by: "web",
        max_attempts: BUILD_MAX_ATTEMPTS,
    });

    // Best-effort immediate wake of the shared machine. The DB row is
    // authoritative, so a Fly API outage must not fail the user's request —
    // the periodic controller tick (POST /api/internal/builds/controller) is
    // the backstop that starts the machine when queued work is pending.
    await d.wake().catch(() => false);

    return toApiBuild(row);
}

export async function listBuildsForPage(
    pageId: string,
    tenantId: string,
): Promise<BuildResponse[]> {
    const page = await store.loadOwnedPage(pageId, tenantId);
    if (!page) throw new HttpError("Project not found", 404);
    const rows = await store.listBuildsForPage(pageId, tenantId);
    return rows.map(toApiBuild);
}

export async function getBuildForTenant(
    buildId: string,
    tenantId: string,
): Promise<BuildResponse> {
    const row = await store.loadBuildForTenant(buildId, tenantId);
    if (!row) throw new HttpError("Build not found", 404);
    return toApiBuild(row);
}

export interface ClaimedBuild {
    build: BuildResponse;
    token: string;
    commit_sha: string | null;
    repo_url: string;
    branch: string;
    framework: string;
    build_command: string | null;
    output_dir: string | null;
}

/**
 * Claim the next queued job for a worker. Mints the short-lived job token
 * returned to the machine (plaintext) while only storing its hash.
 */
export async function claimBuildForWorker(
    workerId: string,
    now: Date = new Date(),
): Promise<ClaimedBuild | null> {
    const secret = generateJobSecret();
    const tokenHash = hashJobSecret(secret);
    const tokenExpiresAt = new Date(
        now.getTime() + BUILD_JOB_TOKEN_TTL_SECONDS * 1000,
    );
    const leaseExpiresAt = new Date(now.getTime() + BUILD_LEASE_SECONDS * 1000);

    const row = await store.claimNextBuild({
        workerId,
        tokenHash,
        tokenExpiresAt,
        leaseExpiresAt,
    });
    if (!row) return null;

    return {
        build: toApiBuild(row),
        token: formatJobToken(row.id, secret),
        commit_sha: row.commit_sha,
        repo_url: row.repo_url,
        branch: row.branch,
        framework: row.framework,
        build_command: row.build_command,
        output_dir: row.output_dir,
    };
}

export async function appendBuildLog(params: {
    buildId: string;
    workerId: string;
    chunk: string;
    stage?: "cloning" | "installing" | "building" | "deploying" | "ready";
}): Promise<void> {
    const row = await store.loadBuildById(params.buildId);
    if (!row) throw new HttpError("Build not found", 404);
    if (isTerminalStatus(row.status)) {
        throw new HttpError("Build already finished", 409);
    }
    if (row.worker_id && row.worker_id !== params.workerId) {
        throw new HttpError("Build is owned by another worker", 403);
    }

    const safe = redactSecrets(params.chunk);
    const result = boundedLogAppend(
        row.log,
        row.log_bytes,
        safe,
        MAX_BUILD_LOG_BYTES,
        row.log_truncated,
    );
    await store.updateBuildLog(
        params.buildId,
        result.log,
        result.logBytes,
        result.truncated,
        params.stage,
    );
}

export async function heartbeatBuild(
    buildId: string,
    workerId: string,
    now: Date = new Date(),
): Promise<void> {
    const leaseExpiresAt = new Date(now.getTime() + BUILD_LEASE_SECONDS * 1000);
    const ok = await store.heartbeatBuild(buildId, workerId, leaseExpiresAt);
    if (!ok) throw new HttpError("Build lease is no longer held", 409);
}

/**
 * Finish a job. A `completed` job must reference a deployment this build
 * actually produced, so a buggy or malicious machine cannot attach another
 * project's deployment. Idempotent: a terminal row is returned unchanged.
 */
export async function completeBuild(params: {
    buildId: string;
    workerId: string;
    body: CompleteBuildInput;
}): Promise<BuildResponse> {
    const row = await store.loadBuildById(params.buildId);
    if (!row) throw new HttpError("Build not found", 404);
    if (isTerminalStatus(row.status)) return toApiBuild(row);
    if (row.worker_id && row.worker_id !== params.workerId) {
        throw new HttpError("Build is owned by another worker", 403);
    }

    if (params.body.status === "completed") {
        const deploymentId = params.body.deploymentId;
        if (!deploymentId) {
            throw new HttpError("deploymentId is required on completion", 400);
        }
        const owns = await store.isDeploymentOfBuild(
            deploymentId,
            params.buildId,
            row.page_id,
        );
        if (!owns) {
            throw new HttpError(
                "deploymentId was not produced by this build",
                409,
            );
        }
        const updated = await store.finishBuild({
            buildId: params.buildId,
            status: "completed",
            deploymentId,
            error: null,
            stage: "ready",
        });
        await releasePageBuildLock(row.page_id);
        return toApiBuild(
            updated ?? (await store.loadBuildById(params.buildId))!,
        );
    }

    const message = sanitizeError(params.body.error ?? "Build failed");
    const updated = await store.finishBuild({
        buildId: params.buildId,
        status: "failed",
        error: message,
    });
    await recordFailure(row, message);
    await releasePageBuildLock(row.page_id);
    return toApiBuild(updated ?? (await store.loadBuildById(params.buildId))!);
}

async function recordFailure(
    row: store.BuildRow,
    message: string,
): Promise<void> {
    try {
        await store.insertBuildFailure({
            original_job_id: row.id,
            queue_name: "build-machine",
            tenant_id: row.tenant_id,
            page_id: row.page_id,
            build_id: row.id,
            attempts: row.attempts,
            error_type: "unknown",
            error_message: message,
        });
    } catch (err) {
        console.error("[builds] failed to record build failure:", err);
    }
}

/**
 * Reconciliation sweep (called from the controller tick): requeue `active`
 * jobs whose worker lease expired, failing them once attempts are exhausted.
 */
export async function reconcileBuilds(
    now: Date = new Date(),
): Promise<{ requeued: number; failed: number }> {
    const stale = await store.listStaleActiveBuilds(now);
    let requeued = 0;
    let failed = 0;

    // Requeued jobs become `queued`; the controller tick that immediately
    // follows this sweep sees them and starts the machine if it is stopped.
    for (const row of stale) {
        const action = decideStaleReclaim(row, row.lease_expires_at, now);
        if (action === "requeue") {
            const ok = await store.requeueBuild(row.id);
            if (ok) {
                requeued++;
            }
        } else if (action === "fail") {
            const updated = await store.finishBuild({
                buildId: row.id,
                status: "failed",
                error: "Build worker lease expired",
            });
            if (updated) {
                failed++;
                await recordFailure(updated, "Build worker lease expired");
                await releasePageBuildLock(updated.page_id);
            }
        }
    }

    return { requeued, failed };
}

/**
 * Acquire a per-page build lock so the dashboard cannot enqueue two concurrent
 * builds for the same project. The lock is advisory and short-lived; the DB
 * still allows retries after it expires.
 */
export async function acquirePageBuildLock(pageId: string): Promise<boolean> {
    const res = await redis.set(redisKey(`build:page:${pageId}`), "1", {
        nx: true,
        ex: 60 * 60,
    });
    return res === "OK";
}

/**
 * Release the per-page build lock. Called on every terminal transition (a
 * build that finished or failed) and when a create attempt fails after the lock
 * was taken. Never throws — an orphaned lock simply expires with its TTL.
 */
export async function releasePageBuildLock(pageId: string): Promise<void> {
    try {
        await redis.del(redisKey(`build:page:${pageId}`));
    } catch (err) {
        console.error("[builds] failed to release page build lock:", err);
    }
}
