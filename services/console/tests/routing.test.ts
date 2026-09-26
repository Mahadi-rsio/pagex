import { test } from "node:test";
import assert from "node:assert/strict";

import { redisKey } from "../src/server/api/infrastructure/cache/redis";
import {
    ACTIVE_DEPLOYMENT_ROUTING_TTL_SECONDS,
    activeDeploymentMappingKey,
    createRoutingWriter,
    type RoutingClient,
    subdomainMappingKey,
} from "../src/server/api/infrastructure/cache/routing";

type SetCall = { key: string; value: string; ex?: number };

class FakeRedis implements RoutingClient {
    readonly store = new Map<string, string>();
    readonly sets: SetCall[] = [];
    readonly dels: string[][] = [];
    fail = false;

    async set(key: string, value: string, opts?: { ex: number }) {
        if (this.fail) throw new Error("redis unavailable");
        this.sets.push(opts ? { key, value, ex: opts.ex } : { key, value });
        this.store.set(key, value);
        return "OK";
    }

    async del(...keys: string[]) {
        if (this.fail) throw new Error("redis unavailable");
        this.dels.push(keys);
        for (const key of keys) this.store.delete(key);
        return keys.length;
    }
}

function makeWriter() {
    const client = new FakeRedis();
    return { client, writer: createRoutingWriter(client) };
}

test("key contract is stable and namespaced like every other console key", () => {
    assert.equal(subdomainMappingKey("demo.1234"), "site:subdomain:demo.1234");
    assert.equal(activeDeploymentMappingKey("site-1"), "site:site-1:active");
    assert.equal(ACTIVE_DEPLOYMENT_ROUTING_TTL_SECONDS, 3600);
});

test("new project creates the subdomain → site_id Redis mapping (no TTL)", async () => {
    const { client, writer } = makeWriter();

    await writer.setSubdomainMapping("demo.1234", "site-1");

    assert.equal(client.sets.length, 1);
    const call = client.sets[0]!;
    assert.equal(call.key, redisKey("site:subdomain:demo.1234"));
    assert.equal(call.value, "site-1");
    // Immutable for the life of the project: no expiry.
    assert.equal(call.ex, undefined);
});

test("deploy updates the active deployment mapping with the 1h safety TTL", async () => {
    const { client, writer } = makeWriter();

    await writer.setActiveDeploymentMapping("site-1", "dep-2");

    assert.equal(client.sets.length, 1);
    const call = client.sets[0]!;
    assert.equal(call.key, redisKey("site:site-1:active"));
    assert.equal(call.value, "dep-2");
    assert.equal(call.ex, ACTIVE_DEPLOYMENT_ROUTING_TTL_SECONDS);
});

test("rollback updates the active deployment mapping (same key, new deployment)", async () => {
    const { client, writer } = makeWriter();

    await writer.setActiveDeploymentMapping("site-1", "dep-2");
    await writer.setActiveDeploymentMapping("site-1", "dep-1");

    const activeCalls = client.sets.filter(
        (c) => c.key === redisKey("site:site-1:active"),
    );
    assert.equal(activeCalls.length, 2);
    assert.equal(activeCalls[1]!.value, "dep-1");
});

test("deployment updates never rewrite the subdomain mapping", async () => {
    const { client, writer } = makeWriter();

    await writer.setActiveDeploymentMapping("site-1", "dep-2");

    assert.equal(
        client.sets.some(
            (c) => c.key === redisKey(subdomainMappingKey("demo.1234")),
        ),
        false,
    );
});

test("project deletion removes the subdomain Redis key", async () => {
    const { client, writer } = makeWriter();

    await writer.deleteSubdomainMapping("demo.1234");

    assert.deepEqual(client.dels, [[redisKey("site:subdomain:demo.1234")]]);
});

test("Redis failure does not propagate, keeping PostgreSQL authoritative", async () => {
    const { client, writer } = makeWriter();
    client.fail = true;

    // Restore the noisy log after the assertions so failures stay quiet.
    const originalError = console.error;
    console.error = () => {};
    try {
        await assert.doesNotReject(() =>
            writer.setSubdomainMapping("demo.1234", "site-1"),
        );
        await assert.doesNotReject(() =>
            writer.setActiveDeploymentMapping("site-1", "dep-2"),
        );
        await assert.doesNotReject(() =>
            writer.deleteSubdomainMapping("demo.1234"),
        );
    } finally {
        console.error = originalError;
    }

    // Nothing was written: a later blob-server miss rebuilds from Postgres.
    assert.equal(client.store.size, 0);
    assert.equal(client.sets.length, 0);
    assert.equal(client.dels.length, 0);
});
