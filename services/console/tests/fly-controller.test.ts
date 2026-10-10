import { test } from "node:test";
import assert from "node:assert/strict";
import {
    createFlyClient,
    FlyApiError,
} from "../src/features/builds/fly.controller";

/** Build a fake Response for the injected fetch. */
function res(status: number, body: unknown = {}) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
    });
}

function makeFetch(...responses: Response[]) {
    let i = 0;
    return async () => {
        const r = responses[Math.min(i, responses.length - 1)]!;
        i++;
        return r;
    };
}

const config = {
    apiToken: "test-token",
    appName: "test-app",
    machineId: "test-machine",
    host: "https://api.machines.dev",
};

test("getState maps a healthy state", async () => {
    const client = createFlyClient(
        config,
        makeFetch(res(200, { state: "started" })),
    );
    assert.equal(await client.getState(), "started");
});

test("getState surfaces a 403 as a permanent FlyApiError", async () => {
    const client = createFlyClient(
        config,
        makeFetch(res(403, { error: "forbidden" })),
    );
    await assert.rejects(
        async () => client.getState(),
        (err: unknown) => {
            assert.ok(err instanceof FlyApiError);
            assert.equal((err as FlyApiError).status, 403);
            assert.equal((err as FlyApiError).operation, "getState");
            assert.equal((err as FlyApiError).retryable, false);
            assert.ok(!(err as Error).message.includes("test-token"));
            return true;
        },
    );
});

test("start throws a non-retryable error on 403 (permanent, no futile retries)", async () => {
    const client = createFlyClient(
        config,
        makeFetch(res(403, { error: "forbidden" })),
    );
    await assert.rejects(
        async () => client.start(),
        (err: unknown) => {
            assert.ok(err instanceof FlyApiError);
            assert.equal((err as FlyApiError).status, 403);
            assert.equal((err as FlyApiError).retryable, false);
            return true;
        },
    );
});

test("start treats 409 (already started) as acceptable, not an error", async () => {
    const client = createFlyClient(config, makeFetch(res(409, {})));
    await client.start();
});

test("start throws a retryable error on 5xx", async () => {
    const client = createFlyClient(
        config,
        makeFetch(res(503, { error: "unavailable" })),
    );
    await assert.rejects(
        async () => client.start(),
        (err: unknown) => {
            assert.ok(err instanceof FlyApiError);
            assert.equal((err as FlyApiError).status, 503);
            assert.equal((err as FlyApiError).retryable, true);
            return true;
        },
    );
});

test("start throws a retryable error on 429 (rate limited)", async () => {
    const client = createFlyClient(
        config,
        makeFetch(res(429, { error: "rate limited" })),
    );
    await assert.rejects(
        async () => client.start(),
        (err: unknown) => {
            assert.ok(err instanceof FlyApiError);
            assert.equal((err as FlyApiError).status, 429);
            assert.equal((err as FlyApiError).retryable, true);
            return true;
        },
    );
});

test("getState surfaces 404 (machine not found) as permanent", async () => {
    const client = createFlyClient(
        config,
        makeFetch(res(404, { error: "not found" })),
    );
    await assert.rejects(
        async () => client.getState(),
        (err: unknown) => {
            assert.ok(err instanceof FlyApiError);
            assert.equal((err as FlyApiError).status, 404);
            assert.equal((err as FlyApiError).retryable, false);
            return true;
        },
    );
});

test("error message never leaks the API token", async () => {
    const client = createFlyClient(
        config,
        makeFetch(res(500, { error: "boom" })),
    );
    await assert.rejects(
        async () => client.start(),
        (err: unknown) => {
            assert.ok(err instanceof Error);
            assert.ok(!(err as Error).message.includes("test-token"));
            assert.ok(!(err as Error).message.includes("Bearer"));
            return true;
        },
    );
});
