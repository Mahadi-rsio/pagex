import { QUEUE_MAX_RETRIES } from "./config";
import { getDb } from "./db";
import { runDeploymentGC } from "./handlers/deployment-gc";
import { runPageDelete } from "./handlers/page-delete";
import type { HandlerResult } from "./handlers/shared";
import {
    DEPLOYMENT_GC_JOB,
    PAGE_DELETE_JOB,
    parseBackgroundJob,
    type BackgroundJob,
} from "./job";
import { createRepo } from "./repo";
import { createRedisClient } from "./redis";

const SERVICE_NAME = "pagex-cleanup-worker";

export default {
    /** Health probe. The worker does its real work through the queue handler. */
    async fetch(_request: Request, _env: Env): Promise<Response> {
        return Response.json({
            service: SERVICE_NAME,
            status: "ok",
            consumes: [DEPLOYMENT_GC_JOB, PAGE_DELETE_JOB],
        });
    },

    /**
     * Push consumer for `pagex-background`. Every message is explicitly
     * acknowledged or retried — the handler never throws out of `queue`, so a
     * single bad message cannot wedge the whole batch.
     */
    async queue(batch: MessageBatch<unknown>, env: Env): Promise<void> {
        await Promise.allSettled(
            batch.messages.map((message) =>
                handleMessage(message, (job) => dispatchJob(job, env)),
            ),
        );
    },
} satisfies ExportedHandler<Env, unknown>;

/** Route a parsed job to the matching cleanup handler. */
export type Dispatcher = (job: BackgroundJob) => Promise<HandlerResult>;

/**
 * Acknowledge/retry a single queue message. Injectable dispatcher keeps the
 * ack/retry policy fully unit-testable without a live database.
 */
export async function handleMessage(
    message: Message<unknown>,
    dispatch: Dispatcher,
): Promise<void> {
    const job = parseBackgroundJob(message.body);
    if (!job) {
        // Malformed bodies are permanent: ack and log so the queue can't wedge.
        console.error(
            `[queue] malformed message body; acking: ${JSON.stringify(message.body)}`,
        );
        await safeAck(message);
        return;
    }

    let result: HandlerResult;
    try {
        result = await dispatch(job);
    } catch (err) {
        // Any thrown error is treated as transient (DB/R2 outage) and retried.
        console.error(
            `[queue] transient failure for ${job.type} (attempt ${message.attempts}):`,
            err,
        );
        if (message.attempts >= QUEUE_MAX_RETRIES) {
            console.error(
                `[queue] giving up on ${job.type} after ${message.attempts} attempts; acking`,
            );
            await safeAck(message);
        } else {
            await safeRetry(message);
        }
        return;
    }

    switch (result.outcome) {
        case "completed":
        case "skipped":
            await safeAck(message);
            return;
        case "permanent-error":
            console.error(
                `[queue] permanent error for ${job.type}: ${result.reason}`,
            );
            await safeAck(message);
            return;
    }
}

async function dispatchJob(
    job: BackgroundJob,
    env: Env,
): Promise<HandlerResult> {
    const repo = createRepo(getDb(env));
    const bucket = env.BLOBS;

    if (job.type === DEPLOYMENT_GC_JOB) {
        return runDeploymentGC(job, { repo, bucket });
    }

    const redis = createRedisClient(env);
    const redisPrefix = env.REDIS_KEY_PREFIX ?? "px";
    return runPageDelete(job, {
        repo,
        bucket,
        redis,
        redisPrefix,
    });
}

async function safeAck(message: Message<unknown>): Promise<void> {
    try {
        await message.ack();
    } catch (err) {
        console.error("[queue] ack failed:", err);
    }
}

async function safeRetry(message: Message<unknown>): Promise<void> {
    try {
        await message.retry();
    } catch (err) {
        console.error("[queue] retry failed:", err);
    }
}
