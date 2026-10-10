import fs from "node:fs";
import path from "node:path";
import type { ConsoleClient, ClaimedJob, BuildStage } from "./console.js";
import type { RunnerConfig } from "./config.js";
import { buildScriptEnv } from "./env.js";
import { chunkLog, redactSecrets } from "./log.js";
import { createLogSink, type LogSink } from "./log-sink.js";
import { run } from "./process.js";
import { cloneRepo, resolveBuildPlan } from "./workspace.js";
import { runCliDeploy } from "./deploy.js";

const MAX_CHUNK = 60 * 1024;

export interface Logger {
    info(msg: string): void;
    error(msg: string, err?: unknown): void;
}

const defaultLogger: Logger = {
    info: (msg) => console.log(`[build-runner] ${msg}`),
    error: (msg, err) => console.error(`[build-runner] ${msg}`, err ?? ""),
};

export interface RunnerDeps {
    client: ConsoleClient;
    config: RunnerConfig;
    logger?: Logger;
}

/** Run exactly one claimed job end-to-end. Never throws. */
export async function processJob(job: ClaimedJob, deps: RunnerDeps): Promise<void> {
    const { client, config } = deps;
    const logger = deps.logger ?? defaultLogger;
    const workerId = config.workerId;
    const buildId = job.build.id;

    const workspace = fs.mkdtempSync(path.join(config.workspaceDir, "pagex-build-"));
    let stage: BuildStage = "cloning";

    // Buffered, serialized, bounded log sink. Replaces the old fire-and-forget
    // per-chunk POSTs so a chatty build cannot starve heartbeats/completions or
    // exhaust the API quota with unbounded requests.
    const logSink: LogSink = createLogSink(
        client,
        buildId,
        job.token,
        workerId,
    );
    let heartbeat: NodeJS.Timeout | undefined;

    const onOutput = (chunk: string) => {
        const safe = redactSecrets(chunk);
        for (const piece of chunkLog(safe, MAX_CHUNK)) {
            logSink.append(piece, stage);
        }
    };

    const reportDropped = () => {
        const dropped = logSink.droppedBytes();
        if (dropped > 0) {
            logger.error(
                `[build-runner] dropped ${dropped} bytes of build log for ${buildId} (console unavailable or quota exceeded)`,
            );
        }
    };

    heartbeat = setInterval(() => {
        // Heartbeats go through their own channel and are never queued behind
        // log flushes, so log traffic cannot starve lease renewal.
        void client
            .heartbeat(buildId, job.token, workerId)
            .catch((err) => logger.error(`heartbeat failed for ${buildId}`, err));
    }, config.heartbeatIntervalMs);

    try {
        logger.info(`building ${buildId} (${job.repo_url}@${job.commit_sha ?? job.branch})`);

        logSink.append(`==> Cloning ${job.repo_url}\n`, stage);
        const buildEnv = buildScriptEnv({ passThrough: config.passThroughEnv });
        // Install must NOT run with NODE_ENV=production, otherwise npm/pnpm
        // skip devDependencies and builds that rely on them (e.g. Tailwind
        // plugins like @tailwindcss/typography) break.
        const installEnv = buildScriptEnv({
            passThrough: config.passThroughEnv,
            nodeEnv: null,
        });
        await cloneRepo({
            repoUrl: job.repo_url,
            commitSha: job.commit_sha ?? job.branch,
            branch: job.branch,
            dir: workspace,
            env: buildEnv,
            timeoutMs: config.jobTimeoutMs,
            onOutput,
        });

        const plan = resolveBuildPlan({
            dir: workspace,
            framework: job.framework,
            buildCommand: job.build_command,
            outputDir: job.output_dir,
        });

        stage = "installing";
        logSink.append(
            `==> Installing dependencies (${plan.packageManager})\n`,
            stage,
        );
        const install = await run(plan.installCommand[0]!, plan.installCommand.slice(1), {
            cwd: workspace,
            env: installEnv,
            timeoutMs: config.jobTimeoutMs,
            onOutput,
        });
        if (install.timedOut) throw new Error("Dependency install timed out");
        if (install.code !== 0) {
            throw new Error(`Dependency install failed (code ${install.code})`);
        }

        stage = "building";
        logSink.append(`==> Building (${plan.framework})\n`, stage);
        const build = await run(plan.buildCommand[0]!, plan.buildCommand.slice(1), {
            cwd: workspace,
            env: buildEnv,
            timeoutMs: config.jobTimeoutMs,
            onOutput,
        });
        if (build.timedOut) throw new Error("Build timed out");
        if (build.code !== 0) throw new Error(`Build failed (code ${build.code})`);

        const outputPath = path.join(workspace, plan.outputDir);
        if (!fs.existsSync(outputPath)) {
            throw new Error(`Build output directory not found: ${plan.outputDir}`);
        }

        stage = "deploying";
        logSink.append("==> Deploying\n", stage);
        const outcome = await runCliDeploy({
            cliEntry: config.cliEntry,
            consoleUrl: config.consoleUrl,
            jobToken: job.token,
            projectId: job.build.page_id,
            outputDir: plan.outputDir,
            cwd: workspace,
            timeoutMs: config.jobTimeoutMs,
            onOutput,
        });

        stage = "ready";
        logSink.append("==> Build complete\n", stage);

        // Best-effort flush of the log tail before reporting completion. Bounded
        // by the sink's retry/backoff so a console outage cannot deadlock the
        // build or indefinitely delay completion.
        try {
            await logSink.flush();
        } catch (flushErr) {
            logger.error(`log flush failed for ${buildId}`, flushErr);
        }
        reportDropped();

        await client.complete(buildId, job.token, workerId, {
            status: "completed",
            deploymentId: outcome.deploymentId,
            stage,
        });
        logger.info(`completed ${buildId} -> ${outcome.deploymentId}`);
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error(`job ${buildId} failed`, err);
        try {
            logSink.append(`\n==> Build failed: ${message}\n`);
            await logSink.flush();
            reportDropped();
            await client.complete(buildId, job.token, workerId, {
                status: "failed",
                error: message,
            });
        } catch (reportErr) {
            logger.error(`failed to report failure for ${buildId}`, reportErr);
        }
    } finally {
        if (heartbeat) clearInterval(heartbeat);
        logSink.dispose();
        try {
            fs.rmSync(workspace, { recursive: true, force: true });
        } catch (cleanupErr) {
            logger.error(`failed to clean workspace ${workspace}`, cleanupErr);
        }
    }
}

/**
 * Claim and process jobs until the queue reports none left, then run one
 * controller tick. Returns the number of jobs processed.
 */
export async function runUntilIdle(deps: RunnerDeps): Promise<number> {
    const logger = deps.logger ?? defaultLogger;
    let processed = 0;

    while (true) {
        let job: ClaimedJob | null;
        try {
            job = await deps.client.claim(deps.config.workerId);
        } catch (err) {
            logger.error("claim request failed", err);
            break;
        }
        if (!job) break;
        await processJob(job, deps);
        processed++;
    }

    try {
        await deps.client.controllerTick();
    } catch (err) {
        logger.error("controller tick failed", err);
    }

    return processed;
}
