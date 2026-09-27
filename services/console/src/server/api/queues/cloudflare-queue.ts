import type { BackgroundJob } from "./background-job";

/**
 * Cloudflare Queues producer — HTTP API only.
 *
 * There is deliberately no Worker binding: the console runs on Vercel
 * (serverless) and reaches the queue over
 *
 *   POST https://api.cloudflare.com/client/v4/accounts/{CF_ACCOUNT_ID}/queues/{CF_QUEUE_ID}/messages
 *
 * Env: `CF_ACCOUNT_ID`, `CF_QUEUE_ID`, `CF_QUEUE_API_TOKEN`.
 *
 * The payload is `{"body": <job object>}`. Cloudflare requires `body` to be a
 * JSON object; a stringified body is rejected by the API's validator. The
 * `messages: [...]` shape belongs to the separate `messages/batch` endpoint.
 *
 * **Publishers must await this call and swallow its errors.** The console is
 * serverless, so a fire-and-forget promise is dropped whenever the invocation is
 * frozen; awaiting guarantees the message is accepted by Cloudflare before the
 * response is returned. Conversely a queue outage must never fail a commit or a
 * delete that already succeeded in PostgreSQL, so this function resolves with
 * `false` instead of throwing.
 */

const QUEUE_API_BASE = "https://api.cloudflare.com/client/v4";

/** Cloudflare's own guidance is to keep the publish call well under the
 * request budget so a slow queue API cannot eat the caller's timeout. */
const ENQUEUE_TIMEOUT_MS = 5_000;

/** One retry with a short backoff: a single transient 5xx must not lose a job. */
const ENQUEUE_ATTEMPTS = 2;

export interface QueueProducer {
    enqueue(job: BackgroundJob): Promise<boolean>;
}

interface CloudflareErrorBody {
    success?: boolean;
    errors?: Array<{ code?: number; message?: string }>;
    messages?: unknown;
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isQueueConfigured(): boolean {
    return Boolean(
        process.env.CF_ACCOUNT_ID &&
            process.env.CF_QUEUE_ID &&
            process.env.CF_QUEUE_API_TOKEN,
    );
}

/**
 * Build a queue producer over any `fetch`, so tests can inject a stub.
 * The application uses the singleton `backgroundQueue` below.
 */
export function createQueueProducer(fetchImpl: typeof fetch): QueueProducer {
    return {
        async enqueue(job) {
            const accountId = process.env.CF_ACCOUNT_ID;
            const queueId = process.env.CF_QUEUE_ID;
            const token = process.env.CF_QUEUE_API_TOKEN;

            if (!accountId || !queueId || !token) {
                console.warn(
                    "[queue] CF_ACCOUNT_ID / CF_QUEUE_ID / CF_QUEUE_API_TOKEN are not set; " +
                        `dropped background job "${job.type}"`,
                );
                return false;
            }

            const url = `${QUEUE_API_BASE}/accounts/${accountId}/queues/${queueId}/messages`;
            // Cloudflare's push endpoint takes ONE message and requires `body` to
            // be a JSON object — a stringified body is rejected with
            // "Expected object, received string at body", and the same endpoint
            // rejects a top-level `messages` array (that is `messages/batch`).
            // The Go worker receives `body` back as the serialized object.
            const body = JSON.stringify({ body: job });

            for (let attempt = 1; attempt <= ENQUEUE_ATTEMPTS; attempt++) {
                try {
                    const res = await fetchImpl(url, {
                        method: "POST",
                        headers: {
                            "content-type": "application/json",
                            authorization: `Bearer ${token}`,
                        },
                        body,
                        signal: AbortSignal.timeout(ENQUEUE_TIMEOUT_MS),
                    });

                    if (res.ok) return true;

                    const detail = await readErrorDetail(res);
                    const retriable = res.status >= 500 || res.status === 429;

                    console.error(
                        `[queue] enqueue "${job.type}" failed (attempt ${attempt}/${ENQUEUE_ATTEMPTS}, status ${res.status}): ${detail}`,
                    );

                    if (!retriable || attempt === ENQUEUE_ATTEMPTS)
                        return false;
                } catch (err) {
                    console.error(
                        `[queue] enqueue "${job.type}" threw (attempt ${attempt}/${ENQUEUE_ATTEMPTS}):`,
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

async function readErrorDetail(res: Response): Promise<string> {
    try {
        const parsed = (await res.json()) as CloudflareErrorBody;
        if (parsed.errors?.length) {
            return parsed.errors
                .map((e) => `${e.code ?? "?"} ${e.message ?? "unknown"}`)
                .join("; ");
        }
    } catch {
        // non-JSON error body — fall through
    }
    return res.statusText || "no detail";
}

export const backgroundQueue: QueueProducer = createQueueProducer(fetch);

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
