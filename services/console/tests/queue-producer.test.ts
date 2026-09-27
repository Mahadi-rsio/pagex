import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    createQueueProducer,
    enqueueBackgroundJob,
    isQueueConfigured,
    type QueueProducer,
} from "@/server/api/queues/cloudflare-queue";
import {
    DEPLOYMENT_GC_JOB,
    PAGE_DELETE_JOB,
    parseBackgroundJob,
} from "@/server/api/queues/background-job";

const ORIGINAL_ENV = { ...process.env };

function withQueueEnv(fn: () => void | Promise<void>) {
    process.env.CF_ACCOUNT_ID = "acct";
    process.env.CF_QUEUE_ID = "q1";
    process.env.CF_QUEUE_API_TOKEN = "token";
    return Promise.resolve(fn()).finally(() => {
        process.env = { ...ORIGINAL_ENV };
    });
}

/** Records every fetch the producer makes and replies with a canned status. */
function stubFetch(statuses: number[] = [200]): {
    fetchImpl: typeof fetch;
    calls: Array<{ url: string; init: RequestInit }>;
} {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    let i = 0;
    const fetchImpl = (async (url: string, init: RequestInit) => {
        calls.push({ url: String(url), init });
        const status = statuses[Math.min(i, statuses.length - 1)] ?? 200;
        i++;
        return new Response(JSON.stringify({ success: status < 300 }), {
            status,
            headers: { "content-type": "application/json" },
        });
    }) as unknown as typeof fetch;
    return { fetchImpl, calls };
}

describe("cloudflare queue producer", () => {
    it("is not configured without the Cloudflare env vars", () => {
        process.env.CF_ACCOUNT_ID = "";
        process.env.CF_QUEUE_ID = "";
        process.env.CF_QUEUE_API_TOKEN = "";
        assert.equal(isQueueConfigured(), false);

        process.env.CF_ACCOUNT_ID = "acct";
        assert.equal(isQueueConfigured(), false);
    });

    // Cloudflare's push endpoint takes ONE message and requires `body` to be a
    // JSON object. A stringified body is rejected with
    // "Expected object, received string at body", and a top-level `messages`
    // array belongs to the separate messages/batch endpoint. Both mistakes fail
    // silently at runtime because the producer swallows errors, so the payload
    // shape is asserted here.
    it("posts a single message with an object body", async () => {
        await withQueueEnv(async () => {
            const { fetchImpl, calls } = stubFetch();
            const producer = createQueueProducer(fetchImpl);

            const ok = await producer.enqueue({
                type: DEPLOYMENT_GC_JOB,
                page_id: "p1",
                site_id: "s1",
                deployment_id: "d1",
            });
            assert.equal(ok, true);
            assert.equal(calls.length, 1);

            const { url, init } = calls[0]!;
            assert.equal(
                url,
                "https://api.cloudflare.com/client/v4/accounts/acct/queues/q1/messages",
            );
            assert.equal(init.method, "POST");
            assert.equal(
                (init.headers as Record<string, string>).authorization,
                "Bearer token",
            );

            const payload = JSON.parse(init.body as string) as Record<
                string,
                unknown
            >;
            assert.deepEqual(
                Object.keys(payload),
                ["body"],
                "only `body` at the top level",
            );
            assert.equal(
                typeof payload.body,
                "object",
                "`body` must be a JSON object, not a stringified payload",
            );
            assert.deepEqual(payload.body, {
                type: DEPLOYMENT_GC_JOB,
                page_id: "p1",
                site_id: "s1",
                deployment_id: "d1",
            });
        });
    });

    it("returns false instead of throwing when unconfigured", async () => {
        process.env.CF_ACCOUNT_ID = "";
        process.env.CF_QUEUE_ID = "";
        process.env.CF_QUEUE_API_TOKEN = "";
        const producer = createQueueProducer(stubFetch().fetchImpl);
        assert.equal(
            await producer.enqueue({
                type: PAGE_DELETE_JOB,
                page_id: "p",
                site_id: "s",
            }),
            false,
        );
    });

    // A commit or delete that already succeeded in PostgreSQL must not fail
    // because the queue is unavailable.
    it("swallows API errors so deployments are unaffected", async () => {
        await withQueueEnv(async () => {
            const producer = createQueueProducer(stubFetch([500]).fetchImpl);
            assert.equal(
                await producer.enqueue({
                    type: PAGE_DELETE_JOB,
                    page_id: "p",
                    site_id: "s",
                }),
                false,
            );
        });
    });

    it("retries a transient 5xx once", async () => {
        await withQueueEnv(async () => {
            const { fetchImpl, calls } = stubFetch([500, 200]);
            const producer = createQueueProducer(fetchImpl);

            assert.equal(
                await producer.enqueue({
                    type: PAGE_DELETE_JOB,
                    page_id: "p",
                    site_id: "s",
                }),
                true,
            );
            assert.equal(calls.length, 2);
        });
    });

    it("does not retry a 4xx", async () => {
        await withQueueEnv(async () => {
            const { fetchImpl, calls } = stubFetch([400]);
            const producer = createQueueProducer(fetchImpl);

            assert.equal(
                await producer.enqueue({
                    type: PAGE_DELETE_JOB,
                    page_id: "p",
                    site_id: "s",
                }),
                false,
            );
            assert.equal(calls.length, 1);
        });
    });

    it("swallows network errors", async () => {
        await withQueueEnv(async () => {
            const fetchImpl = (async () => {
                throw new Error("ECONNREFUSED");
            }) as unknown as typeof fetch;
            const producer = createQueueProducer(fetchImpl);

            assert.equal(
                await producer.enqueue({
                    type: PAGE_DELETE_JOB,
                    page_id: "p",
                    site_id: "s",
                }),
                false,
            );
        });
    });

    it("never throws from enqueueBackgroundJob", async () => {
        const throwing: QueueProducer = {
            enqueue: async () => {
                throw new Error("boom");
            },
        };
        assert.equal(
            await enqueueBackgroundJob(
                { type: PAGE_DELETE_JOB, page_id: "p", site_id: "s" },
                throwing,
            ),
            false,
        );
    });
});

describe("background job contract", () => {
    it("parses a deployment_gc job", () => {
        assert.deepEqual(
            parseBackgroundJob({
                type: DEPLOYMENT_GC_JOB,
                page_id: "p",
                site_id: "s",
                deployment_id: "d",
            }),
            {
                type: DEPLOYMENT_GC_JOB,
                page_id: "p",
                site_id: "s",
                deployment_id: "d",
            },
        );
    });

    it("parses a page_delete job", () => {
        assert.deepEqual(
            parseBackgroundJob({
                type: PAGE_DELETE_JOB,
                page_id: "p",
                site_id: "s",
            }),
            { type: PAGE_DELETE_JOB, page_id: "p", site_id: "s" },
        );
    });

    it("rejects incomplete or unknown payloads", () => {
        for (const raw of [
            null,
            "string",
            42,
            {},
            { type: "other" },
            { type: PAGE_DELETE_JOB },
            { type: PAGE_DELETE_JOB, page_id: "p" },
            { type: DEPLOYMENT_GC_JOB, page_id: "p", site_id: "s" },
        ]) {
            assert.equal(
                parseBackgroundJob(raw),
                null,
                `expected null for ${JSON.stringify(raw)}`,
            );
        }
    });
});
