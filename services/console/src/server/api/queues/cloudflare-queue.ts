import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { BackgroundJob } from "./background-job";

/**
 * Cloudflare Queues producer — native Worker binding.
 *
 * The console runs on Cloudflare Workers (OpenNext) and publishes through the
 * producer binding declared in `wrangler.jsonc`:
 *
 *   queues.producers = [{ "binding": "BACKGROUND_QUEUE", "queue": "pagex-background" }]
 *
 * The runtime injects the binding, so no account ID, queue ID or API token is
 * involved: `CF_ACCOUNT_ID` / `CF_QUEUE_ID` / `CF_QUEUE_API_TOKEN` belong to the
 * Go pull consumer in `services/worker` only. Locally the same binding comes
 * from Wrangler's platform proxy (`initOpenNextCloudflareForDev` in
 * `next.config.ts`), so application code is identical in both environments.
 *
 * The message body is the job object itself. With the Worker compatibility date
 * in use, `send()` defaults to the `json` content type, so the Go consumer's
 * `POST .../messages/pull` still receives `body` as the serialized job — the
 * same payload the old HTTP push endpoint produced with `{"body": <job>}`.
 *
 * **Publishers must await this call and swallow its errors.** The Workers
 * isolate is frozen as soon as the response is returned, so a fire-and-forget
 * promise is dropped; awaiting guarantees the message is written to disk before
 * the response goes out. Conversely a queue outage must never fail a commit or
 * a delete that already succeeded in PostgreSQL, so this function resolves with
 * `false` instead of throwing.
 */

/** Cloudflare's own guidance is to keep the publish call well under the
 * request budget so a slow queue cannot eat the caller's timeout. */
const ENQUEUE_TIMEOUT_MS = 5_000;

/** One retry with a short backoff: a single transient failure must not lose a
 * job. Delivery is at-least-once, and every consumer handler is idempotent, so
 * a duplicate after a lost acknowledgement is safe. */
const ENQUEUE_ATTEMPTS = 2;

export interface QueueProducer {
    enqueue(job: BackgroundJob): Promise<boolean>;
}

/**
 * Structural view of the Cloudflare Queue producer binding (`env.QUEUE.send`).
 * Application code depends on this shape rather than on Wrangler types.
 */
export interface QueueBinding {
    send(message: BackgroundJob): Promise<unknown>;
}

/** Resolves the queue binding; `null` means "not available in this runtime". */
export type QueueBindingResolver = () => Promise<QueueBinding | null>;

/**
 * Resolve `BACKGROUND_QUEUE` from the Cloudflare context.
 *
 * Returns `null` rather than throwing when there is no Worker context (plain
 * Node scripts, `next build`) or when the binding is missing from
 * `wrangler.jsonc` — callers turn that into a dropped job, never a failed
 * request.
 */
export const resolveQueueBinding: QueueBindingResolver = async () => {
    try {
        const { env } = await getCloudflareContext({ async: true });
        const binding = (env as CloudflareEnv | undefined)?.BACKGROUND_QUEUE;
        if (!binding) {
            console.warn(
                "[queue] BACKGROUND_QUEUE binding is missing from the Worker environment",
            );
            return null;
        }
        return binding as QueueBinding;
    } catch (err) {
        console.warn(
            "[queue] no Cloudflare context available:",
            err instanceof Error ? err.message : err,
        );
        return null;
    }
};

/** Whether the queue binding can be resolved in this runtime. */
export async function isQueueConfigured(): Promise<boolean> {
    return (await resolveQueueBinding()) !== null;
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Rejects when `send()` has not settled within the request budget. */
function withTimeout(promise: Promise<unknown>, ms: number): Promise<void> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(
            () => reject(new Error(`queue send timed out after ${ms}ms`)),
            ms,
        );
        promise.then(
            () => {
                clearTimeout(timer);
                resolve();
            },
            (err) => {
                clearTimeout(timer);
                reject(err);
            },
        );
    });
}

/**
 * Build a queue producer over any binding resolver, so tests can inject a stub
 * (or `null`, for the missing-binding path).
 * The application uses the singleton `backgroundQueue` below.
 */
export function createQueueProducer(
    resolveBinding: QueueBindingResolver = resolveQueueBinding,
): QueueProducer {
    return {
        async enqueue(job) {
            const binding = await resolveBinding();
            if (!binding) {
                console.warn(
                    `[queue] queue binding unavailable; dropped background job "${job.type}"`,
                );
                return false;
            }

            for (let attempt = 1; attempt <= ENQUEUE_ATTEMPTS; attempt++) {
                try {
                    await withTimeout(binding.send(job), ENQUEUE_TIMEOUT_MS);
                    return true;
                } catch (err) {
                    console.error(
                        `[queue] enqueue "${job.type}" failed (attempt ${attempt}/${ENQUEUE_ATTEMPTS}):`,
                        err,
                    );
                    if (attempt === ENQUEUE_ATTEMPTS) return false;
                }

                await sleep(250 * attempt);
            }

            return false;
        },
    };
}

export const backgroundQueue: QueueProducer = createQueueProducer();

/**
 * Enqueue a background job. Never throws: the caller's PostgreSQL write has
 * already committed, and deployment/delete must not depend on the queue.
 *
 * The producer is injectable so the error path is testable; production callers
 * omit it and get the module singleton.
 */
export async function enqueueBackgroundJob(
    job: BackgroundJob,
    producer: QueueProducer = backgroundQueue,
): Promise<boolean> {
    try {
        return await producer.enqueue(job);
    } catch (err) {
        console.error(
            `[queue] unexpected failure enqueueing "${job.type}":`,
            err,
        );
        return false;
    }
}
