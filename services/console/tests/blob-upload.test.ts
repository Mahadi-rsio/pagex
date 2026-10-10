import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";

import {
    handleBlobUpload,
    type BlobUploadDeps,
} from "../src/features/deployments/blob-upload.service";
import { buildBlobUploadUrl } from "../src/features/deployments/blob-upload-url";

const TENANT = "tenant-1";
const KEY_PREFIX = "blobs/";

function sha256(body: Buffer | string): string {
    return createHash("sha256").update(body).digest("hex");
}

interface FakeState {
    putCalls: Array<{ key: string; body: Buffer; contentType: string }>;
    exists: boolean;
    failPut: boolean;
}

function makeDeps(
    tokenJson: string | null,
    overrides: Partial<FakeState> = {},
): { deps: BlobUploadDeps; state: FakeState } {
    const state: FakeState = {
        putCalls: [],
        exists: false,
        failPut: false,
        ...overrides,
    };

    const deps: BlobUploadDeps = {
        loadToken: async () => tokenJson,
        objectExists: async () => state.exists,
        objectKey: (hash) => `${KEY_PREFIX}${hash}`,
        putObject: async (key, body, contentType) => {
            if (state.failPut) throw new Error("R2 unavailable");
            state.putCalls.push({ key, body, contentType });
        },
        now: () => 1_000_000,
    };

    return { deps, state };
}

function manifestToken(files: Array<{ hash: string; size: number }>) {
    return JSON.stringify({
        userId: TENANT,
        expiresAt: 1_000_000 + 600,
        fileManifest: files,
    });
}

function uploadRequest(
    token: string,
    hash: string,
    body: Buffer,
    contentType = "text/html",
): Request {
    const url = `https://console.example.com/api/deploy/blob?token=${encodeURIComponent(
        token,
    )}&hash=${hash}`;
    return new Request(url, {
        method: "PUT",
        headers: contentType ? { "content-type": contentType } : undefined,
        body: new Uint8Array(body),
    });
}

test("successful upload writes the blob once with its content type", async () => {
    const body = Buffer.from("hello pagex");
    const hash = sha256(body);
    const { deps, state } = makeDeps(
        manifestToken([{ hash, size: body.byteLength }]),
    );

    const res = await handleBlobUpload(
        uploadRequest("token-abc", hash, body),
        deps,
    );

    assert.equal(res.status, 204);
    assert.equal(state.putCalls.length, 1);
    assert.deepEqual(state.putCalls[0]!.key, `${KEY_PREFIX}${hash}`);
    assert.equal(state.putCalls[0]!.contentType, "text/html");
    assert.ok(state.putCalls[0]!.body.equals(body));
});

test("deduplication skips the write when the blob already exists", async () => {
    const body = Buffer.from("duplicate");
    const hash = sha256(body);
    const { deps, state } = makeDeps(
        manifestToken([{ hash, size: body.byteLength }]),
        { exists: true },
    );

    const res = await handleBlobUpload(
        uploadRequest("token-abc", hash, body),
        deps,
    );

    assert.equal(res.status, 204);
    assert.equal(state.putCalls.length, 0);
});

test("missing token or hash is rejected with 400", async () => {
    const { deps } = makeDeps(null);
    const body = Buffer.from("x");
    const hash = sha256(body);

    const noToken = await handleBlobUpload(
        new Request(`https://c.example.com/api/deploy/blob?hash=${hash}`, {
            method: "PUT",
            body: new Uint8Array(body),
        }),
        deps,
    );
    assert.equal(noToken.status, 400);

    const noHash = await handleBlobUpload(
        new Request("https://c.example.com/api/deploy/blob?token=t", {
            method: "PUT",
            body: new Uint8Array(body),
        }),
        deps,
    );
    assert.equal(noHash.status, 400);
});

test("a malformed hash is rejected before touching storage", async () => {
    const { deps, state } = makeDeps(null);
    const res = await handleBlobUpload(
        uploadRequest("token-abc", "not-a-sha", Buffer.from("x")),
        deps,
    );
    assert.equal(res.status, 400);
    assert.equal(state.putCalls.length, 0);
});

test("a token that is not present in Redis (expired) is rejected with 401", async () => {
    const body = Buffer.from("data");
    const hash = sha256(body);
    const { deps, state } = makeDeps(null);

    const res = await handleBlobUpload(
        uploadRequest("expired-token", hash, body),
        deps,
    );

    assert.equal(res.status, 401);
    assert.equal(state.putCalls.length, 0);
});

test("an expired expiresAt is rejected with 401 even if Redis still has it", async () => {
    const body = Buffer.from("data");
    const hash = sha256(body);
    const token = JSON.stringify({
        userId: TENANT,
        expiresAt: 999_999,
        fileManifest: [{ hash, size: body.byteLength }],
    });
    const { deps } = makeDeps(token);

    const res = await handleBlobUpload(uploadRequest("t", hash, body), deps);
    assert.equal(res.status, 401);
});

test("corrupt token JSON is rejected with 400", async () => {
    const body = Buffer.from("data");
    const hash = sha256(body);
    const { deps } = makeDeps("{not json");

    const res = await handleBlobUpload(uploadRequest("t", hash, body), deps);
    assert.equal(res.status, 400);
});

test("a token without a tenant binding is rejected with 403", async () => {
    const body = Buffer.from("data");
    const hash = sha256(body);
    const token = JSON.stringify({
        fileManifest: [{ hash, size: body.byteLength }],
    });
    const { deps, state } = makeDeps(token);

    const res = await handleBlobUpload(uploadRequest("t", hash, body), deps);
    assert.equal(res.status, 403);
    assert.equal(state.putCalls.length, 0);
});

test("a hash absent from the deployment manifest is rejected with 403", async () => {
    const body = Buffer.from("data");
    const hash = sha256(body);
    const otherHash = sha256("other");
    const { deps, state } = makeDeps(
        manifestToken([{ hash: otherHash, size: 5 }]),
    );

    const res = await handleBlobUpload(uploadRequest("t", hash, body), deps);
    assert.equal(res.status, 403);
    assert.equal(state.putCalls.length, 0);
});

test("a body larger than the per-file ceiling is rejected with 413", async () => {
    const body = Buffer.from("0123456789");
    const hash = sha256(body);
    const token = manifestToken([{ hash, size: body.byteLength }]);
    const { deps, state } = makeDeps(token);
    deps.maxFileSize = 4;

    const res = await handleBlobUpload(uploadRequest("t", hash, body), deps);
    assert.equal(res.status, 413);
    assert.equal(state.putCalls.length, 0);
});

test("a body whose size disagrees with the manifest is rejected with 400", async () => {
    const body = Buffer.from("actual bytes");
    const hash = sha256(body);
    const token = manifestToken([{ hash, size: body.byteLength + 5 }]);
    const { deps } = makeDeps(token);

    const res = await handleBlobUpload(uploadRequest("t", hash, body), deps);
    assert.equal(res.status, 400);
});

test("content that does not match its declared hash is rejected with 400", async () => {
    const body = Buffer.from("actual bytes");
    const declaredHash = sha256("something else");
    const token = manifestToken([
        { hash: declaredHash, size: body.byteLength },
    ]);
    const { deps, state } = makeDeps(token);

    const res = await handleBlobUpload(
        uploadRequest("t", declaredHash, body),
        deps,
    );
    assert.equal(res.status, 400);
    assert.equal(state.putCalls.length, 0);
});

test("an empty upload body is rejected with 400", async () => {
    const body = Buffer.alloc(0);
    const hash = sha256(body);
    const token = manifestToken([{ hash, size: 0 }]);
    const { deps } = makeDeps(token);

    const res = await handleBlobUpload(uploadRequest("t", hash, body), deps);
    assert.equal(res.status, 400);
});

test("storage failures surface as a thrown error for the route to log", async () => {
    const body = Buffer.from("data");
    const hash = sha256(body);
    const { deps } = makeDeps(
        manifestToken([{ hash, size: body.byteLength }]),
        { failPut: true },
    );

    await assert.rejects(
        () => handleBlobUpload(uploadRequest("t", hash, body), deps),
        /R2 unavailable/,
    );
});

test("upload URL is derived from the supplied request origin, not build env", () => {
    const url = buildBlobUploadUrl(
        "https://pagex-console.rsioex.workers.dev/",
        "deploy-token-1",
        "abc123",
    );

    const parsed = new URL(url);
    assert.equal(parsed.protocol, "https:");
    assert.equal(parsed.hostname, "pagex-console.rsioex.workers.dev");
    assert.equal(parsed.port, "");
    assert.equal(parsed.pathname, "/api/deploy/blob");
    assert.equal(parsed.searchParams.get("token"), "deploy-token-1");
    assert.equal(parsed.searchParams.get("hash"), "abc123");
    assert.ok(!url.includes("127.0.0.1"));
    assert.ok(!url.includes("localhost"));
});
