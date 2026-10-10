import { createHash } from "node:crypto";
import { MAX_DEPLOY_FILE_SIZE } from "@/server/api/constants/index";

/**
 * Minimal view of the deployment token payload that the upload endpoint
 * trusts. The token is the tenant-bound capability: it is only written to
 * Redis after `prepareDeploy` has authenticated the tenant and resolved page
 * ownership, so a valid token proves the caller is allowed to push the hashes
 * named in its manifest.
 */
export interface BlobUploadTokenPayload {
    userId?: unknown;
    expiresAt?: unknown;
    fileManifest?: Array<{ hash: string; size: number }>;
}

export interface BlobUploadDeps {
    /** Read the raw deployment-token JSON from Redis (null when missing/expired). */
    loadToken(token: string): Promise<string | null>;
    /** Whether the content-addressed object already exists (dedup check). */
    objectExists(key: string): Promise<boolean>;
    /** Persist the blob bytes to R2. */
    putObject(key: string, body: Buffer, contentType: string): Promise<void>;
    /** Map a blob hash to its R2 object key. */
    objectKey(hash: string): string;
    /** Per-file size ceiling. Defaults to MAX_DEPLOY_FILE_SIZE. */
    maxFileSize?: number;
    /** Clock override (unix seconds) for deterministic expiry tests. */
    now?: () => number;
}

const SHA256_HEX_RE = /^[a-f0-9]{64}$/;
const MAX_TOKEN_LENGTH = 512;

function json(status: number, body: Record<string, unknown>): Response {
    return Response.json(body, { status });
}

function nowSeconds(deps: BlobUploadDeps): number {
    return deps.now ? deps.now() : Math.floor(Date.now() / 1000);
}

/**
 * Token-gated, Worker-mediated blob upload. Replaces S3/MinIO presigned PUTs
 * for deployments on Cloudflare Workers + R2.
 *
 * Validates, in order: request params, path-safe hash, unexpired tenant-bound
 * deployment token, manifest authorization, size bounds and content integrity
 * (SHA-256) before writing to R2. Existing objects are skipped so blob
 * deduplication is preserved.
 */
export async function handleBlobUpload(
    request: Request,
    deps: BlobUploadDeps,
): Promise<Response> {
    let url: URL;
    try {
        url = new URL(request.url);
    } catch {
        return json(400, { error: "Invalid request URL" });
    }

    const token = url.searchParams.get("token");
    const hash = url.searchParams.get("hash");

    if (!token || !hash) {
        return json(400, {
            error: "token and hash query parameters are required",
        });
    }
    if (token.length > MAX_TOKEN_LENGTH) {
        return json(400, { error: "Invalid deployment token" });
    }
    if (!SHA256_HEX_RE.test(hash)) {
        return json(400, { error: "Invalid blob hash" });
    }

    const raw = await deps.loadToken(token);
    if (!raw) {
        return json(401, { error: "Deployment token expired or invalid" });
    }

    let payload: BlobUploadTokenPayload;
    try {
        payload = JSON.parse(raw) as BlobUploadTokenPayload;
    } catch {
        return json(400, { error: "Corrupt deployment token" });
    }

    if (typeof payload.userId !== "string" || payload.userId.length === 0) {
        return json(403, { error: "Deployment token is not tenant-bound" });
    }

    if (
        typeof payload.expiresAt === "number" &&
        payload.expiresAt <= nowSeconds(deps)
    ) {
        return json(401, { error: "Deployment token expired or invalid" });
    }

    const entry = (payload.fileManifest ?? []).find((f) => f.hash === hash);
    if (!entry) {
        return json(403, {
            error: `Hash ${hash} is not in the deployment manifest`,
        });
    }

    const maxFileSize = deps.maxFileSize ?? MAX_DEPLOY_FILE_SIZE;
    const declaredLength = Number(request.headers.get("content-length") ?? "");
    if (Number.isFinite(declaredLength) && declaredLength > maxFileSize) {
        return json(413, { error: "Upload exceeds maximum file size" });
    }

    let body: Buffer;
    try {
        body = Buffer.from(await request.arrayBuffer());
    } catch {
        return json(400, { error: "Invalid upload body" });
    }

    if (body.byteLength === 0) {
        return json(400, { error: "Empty upload body" });
    }
    if (body.byteLength > maxFileSize) {
        return json(413, { error: "Upload exceeds maximum file size" });
    }
    if (
        typeof entry.size === "number" &&
        Number.isFinite(entry.size) &&
        body.byteLength !== entry.size
    ) {
        return json(400, {
            error: `Upload size ${body.byteLength} does not match manifest size ${entry.size}`,
        });
    }

    const digest = createHash("sha256").update(body).digest("hex");
    if (digest !== hash) {
        return json(400, {
            error: "Upload content does not match its declared hash",
        });
    }

    const key = deps.objectKey(hash);
    if (!(await deps.objectExists(key))) {
        const contentType =
            request.headers.get("content-type") || "application/octet-stream";
        await deps.putObject(key, body, contentType);
    }

    return new Response(null, { status: 204 });
}
