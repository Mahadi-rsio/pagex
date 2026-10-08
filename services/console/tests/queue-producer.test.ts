import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    DEPLOYMENT_GC_JOB,
    PAGE_DELETE_JOB,
    parseBackgroundJob,
} from "@/server/api/queues/background-job";
import {
    createQueueProducer,
    enqueueBackgroundJob,
    isQueueConfigured,
    type QueueBinding,
    type QueueProducer,
    resolveQueueBinding,
} from "@/server/api/queues/cloudflare-queue";

/** Records every message handed to the binding; `outcomes` drives failures. */
function stubBinding(outcomes: Array<"ok" | "fail"> = ["ok"]): {
    binding: QueueBinding;
    sent: unknown[];
} {
    const sent: unknown[] = [];
    let i = 0;
    const binding: QueueBinding = {
        async send(message) {
            sent.push(message);
            const outcome = outcomes[Math.min(i, outcomes.length - 1)] ?? "ok";
            i++;
            if (outcome === "fail") throw new Error("queue unavailable");
        },
    };
    return { binding, sent };
}

describe("cloudflare queue binding producer", () => {
    // The message body IS the job object: the Worker compatibility date makes
    // `send()` default to the `json` content type, so the Go pull consumer
    // receives `body` as the serialized job — the exact payload the old HTTP
    // push endpoint produced with `{"body": <job>}`.
    it("sends the job object as the message body", async () => {
        const { binding, sent } = stubBinding();
        const producer = createQueueProducer(async () => binding);

        const ok = await producer.enqueue({
            type: DEPLOYMENT_GC_JOB,
            page_id: "p1",
            site_id: "s1",
            deployment_id: "d1",
        });

        assert.equal(ok, true);
        assert.equal(sent.length, 1);
        assert.deepEqual(sent[0], {
            type: DEPLOYMENT_GC_JOB,
            page_id: "p1",
            site_id: "s1",
            deployment_id: "d1",
        });
    });

    it("sends page_delete without a deployment_id", async () => {
        const { binding, sent } = stubBinding();
        const producer = createQueueProducer(async () => binding);

        assert.equal(
            await producer.enqueue({
                type: PAGE_DELETE_JOB,
                page_id: "p",
                site_id: "s",
            }),
            true,
        );
        assert.deepEqual(sent, [
            { type: PAGE_DELETE_JOB, page_id: "p", site_id: "s" },
        ]);
    });

    it("returns false without sending when the binding is missing", async () => {
        const { sent } = stubBinding();
        const producer = createQueueProducer(async () => null);

        assert.equal(
            await producer.enqueue({
                type: PAGE_DELETE_JOB,
                page_id: "p",
                site_id: "s",
            }),
            false,
        );
        assert.equal(sent.length, 0);
    });

    // The test process is plain Node: there is no Workers context and no
    // binding, which is exactly the "misconfigured / not running on Workers"
    // path the production code must survive.
    it("reports the queue as unconfigured outside a Worker runtime", async () => {
        assert.equal(await isQueueConfigured(), false);
        assert.equal(await resolveQueueBinding(), null);
    });

    // A commit or delete that already succeeded in PostgreSQL must not fail
    // because the queue is unavailable.
    it("swallows send failures so deployments are unaffected", async () => {
        const { binding } = stubBinding(["fail"]);
        const producer = createQueueProducer(async () => binding);

        assert.equal(
            await producer.enqueue({
                type: PAGE_DELETE_JOB,
                page_id: "p",
                site_id: "s",
            }),
            false,
        );
    });

    it("retries a transient failure once", async () => {
        const { binding, sent } = stubBinding(["fail", "ok"]);
        const producer = createQueueProducer(async () => binding);

        assert.equal(
            await producer.enqueue({
                type: PAGE_DELETE_JOB,
                page_id: "p",
                site_id: "s",
            }),
            true,
        );
        assert.equal(sent.length, 2);
    });

    it("does not retry past the attempt budget", async () => {
        const { binding, sent } = stubBinding(["fail", "fail", "ok"]);
        const producer = createQueueProducer(async () => binding);

        assert.equal(
            await producer.enqueue({
                type: PAGE_DELETE_JOB,
                page_id: "p",
                site_id: "s",
            }),
            false,
        );
        assert.equal(sent.length, 2);
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
