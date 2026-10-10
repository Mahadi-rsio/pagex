import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { handleMessage, type Dispatcher } from "../src/index";
import { parseBackgroundJob } from "../src/job";

interface FakeMessage {
    id: string;
    body: unknown;
    attempts: number;
    acked: boolean;
    retried: number;
    ack(): Promise<void>;
    retry(delaySeconds?: number): Promise<void>;
}

function makeMessage(body: unknown, attempts = 1): FakeMessage {
    return {
        id: "msg-1",
        body,
        attempts,
        acked: false,
        retried: 0,
        async ack() {
            this.acked = true;
        },
        async retry() {
            this.retried += 1;
        },
    };
}

async function run(message: FakeMessage, dispatch: Dispatcher): Promise<void> {
    await handleMessage(message as unknown as Message<unknown>, dispatch);
}

describe("handleMessage", () => {
    it("acks malformed bodies without dispatching", async () => {
        let dispatched = false;
        const msg = makeMessage({ type: "garbage" });
        await run(msg, async () => {
            dispatched = true;
            return { outcome: "completed", detail: "" };
        });
        assert.equal(msg.acked, true);
        assert.equal(msg.retried, 0);
        assert.equal(dispatched, false);
    });

    it("acks a completed job", async () => {
        const msg = makeMessage({
            type: "deployment_gc",
            page_id: "p",
            site_id: "s",
            deployment_id: "d",
        });
        await run(msg, async (job) => {
            assert.equal(job.type, "deployment_gc");
            return { outcome: "completed", detail: "done" };
        });
        assert.equal(msg.acked, true);
        assert.equal(msg.retried, 0);
    });

    it("acks a skipped job", async () => {
        const msg = makeMessage({
            type: "page_delete",
            page_id: "p",
            site_id: "s",
        });
        await run(msg, async () => ({
            outcome: "skipped",
            reason: "already purged",
        }));
        assert.equal(msg.acked, true);
        assert.equal(msg.retried, 0);
    });

    it("acks a permanent-error job (no retry loop)", async () => {
        const msg = makeMessage({
            type: "page_delete",
            page_id: "p",
            site_id: "s",
        });
        await run(msg, async () => ({
            outcome: "permanent-error",
            reason: "page not soft-deleted",
        }));
        assert.equal(msg.acked, true);
        assert.equal(msg.retried, 0);
    });

    it("retries a transient failure while attempts remain", async () => {
        const msg = makeMessage(
            {
                type: "deployment_gc",
                page_id: "p",
                site_id: "s",
                deployment_id: "d",
            },
            2,
        );
        await run(msg, async () => {
            throw new Error("db down");
        });
        assert.equal(msg.acked, false);
        assert.equal(msg.retried, 1);
    });

    it("acks after exhausting retries", async () => {
        const msg = makeMessage(
            {
                type: "deployment_gc",
                page_id: "p",
                site_id: "s",
                deployment_id: "d",
            },
            5,
        );
        await run(msg, async () => {
            throw new Error("db still down");
        });
        assert.equal(msg.acked, true);
        assert.equal(msg.retried, 0);
    });

    it("parses the body before dispatching", async () => {
        const msg = makeMessage({
            type: "page_delete",
            page_id: "p",
            site_id: "s",
        });
        let parsed: unknown;
        await run(msg, async (job) => {
            parsed = parseBackgroundJob(job);
            return { outcome: "skipped", reason: "x" };
        });
        assert.deepEqual(parsed, {
            type: "page_delete",
            page_id: "p",
            site_id: "s",
        });
    });
});
