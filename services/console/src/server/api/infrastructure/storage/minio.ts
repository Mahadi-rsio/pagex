import * as Minio from "minio";
import pLimit from "p-limit";

interface StorageConfig {
    client: Minio.Client;
    bucket: string;
}

let storageConfig: StorageConfig | undefined;

function requiredEnv(name: string): string {
    const value = process.env[name];
    if (!value) throw new Error(`${name} environment variable is required`);
    return value;
}

export function getStorageConfig(): StorageConfig {
    if (storageConfig) return storageConfig;

    const endPoint = requiredEnv("MINIO_ENDPOINT");
    storageConfig = {
        client: new Minio.Client({
            endPoint,
            port: Number.parseInt(process.env.MINIO_PORT || "", 10) || 9000,
            useSSL:
                process.env.MINIO_USE_SSL === "true" ||
                (process.env.MINIO_USE_SSL !== "false" &&
                    endPoint !== "minio" &&
                    endPoint !== "localhost"),
            accessKey: requiredEnv("S3_ACCESS_KEY"),
            secretKey: requiredEnv("S3_SECRET_KEY"),
            pathStyle: true,
            region: process.env.MINIO_REGION ?? "us-east-1",
        }),
        bucket: requiredEnv("MINIO_BUCKET"),
    };

    return storageConfig;
}

/** Content-addressed blob object key */
export function blobObjectKey(hash: string): string {
    return `blobs/${hash}`;
}

/** Immutable deployment manifest object key */
export function manifestObjectKey(deploymentId: string): string {
    return `manifests/${deploymentId}.manifest.json`;
}

const BLOB_DELETE_BATCH_SIZE = 100;
const BLOB_DELETE_CONCURRENCY = 10;

/**
 * Bulk-delete content-addressed blob objects (`blobs/{hash}`).
 * Batches of 100, concurrency 10 via p-limit.
 * Returns only hashes whose MinIO delete succeeded (failed batches/hashes are omitted).
 */
export async function deleteBlobObjects(hashes: string[]): Promise<string[]> {
    if (hashes.length === 0) return [];

    const { client, bucket } = getStorageConfig();
    const batches: string[][] = [];
    for (let i = 0; i < hashes.length; i += BLOB_DELETE_BATCH_SIZE) {
        batches.push(hashes.slice(i, i + BLOB_DELETE_BATCH_SIZE));
    }

    const limit = pLimit(BLOB_DELETE_CONCURRENCY);
    const succeeded: string[] = [];

    await Promise.all(
        batches.map((batch) =>
            limit(async () => {
                try {
                    const keys = batch.map((h) => blobObjectKey(h));
                    const results = await client.removeObjects(bucket, keys);
                    const failedKeys = new Set<string>();
                    for (const result of results ?? []) {
                        // Parser returns DeleteResult.Error entries directly ({ Key, Message, ... });
                        // typings also allow a nested { Error: { Key } } shape — handle both.
                        const err =
                            result &&
                            typeof result === "object" &&
                            "Error" in result &&
                            result.Error
                                ? result.Error
                                : (result as
                                      | { Key?: string; Message?: string }
                                      | null
                                      | undefined);
                        const key = err?.Key;
                        if (key) {
                            failedKeys.add(key);
                            console.error(
                                `MinIO delete failed for ${key}: ${err?.Message ?? "unknown"}`,
                            );
                        }
                    }
                    for (const hash of batch) {
                        if (!failedKeys.has(blobObjectKey(hash))) {
                            succeeded.push(hash);
                        }
                    }
                } catch (err) {
                    console.error("MinIO batch delete failed:", err);
                    // Do not mark any hash in this batch as succeeded
                }
            }),
        ),
    );

    return succeeded;
}

/**
 * Store an immutable deployment manifest in MinIO.
 * Returns false if the object already exists (idempotent finalize).
 */
export async function putManifestIfAbsent(
    deploymentId: string,
    body: Buffer,
    contentHash: string,
): Promise<"created" | "exists"> {
    const { client, bucket } = getStorageConfig();
    const key = manifestObjectKey(deploymentId);
    try {
        await client.statObject(bucket, key);
        return "exists";
    } catch {
        // object missing — proceed
    }

    await client.putObject(bucket, key, body, body.length, {
        "Content-Type": "application/json",
        "X-Manifest-Hash": contentHash,
    });
    return "created";
}

/** Read a deployment manifest from MinIO. */
export async function getManifestObject(deploymentId: string): Promise<Buffer> {
    const { client, bucket } = getStorageConfig();
    const stream = await client.getObject(
        bucket,
        manifestObjectKey(deploymentId),
    );
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
}

/** Delete manifest objects for permanently removed deployments. */
export async function deleteManifestObjects(
    deploymentIds: string[],
): Promise<string[]> {
    if (deploymentIds.length === 0) return [];

    const { client, bucket } = getStorageConfig();
    const batches: string[][] = [];
    for (let i = 0; i < deploymentIds.length; i += BLOB_DELETE_BATCH_SIZE) {
        batches.push(deploymentIds.slice(i, i + BLOB_DELETE_BATCH_SIZE));
    }

    const limit = pLimit(BLOB_DELETE_CONCURRENCY);
    const succeeded: string[] = [];

    await Promise.all(
        batches.map((batch) =>
            limit(async () => {
                try {
                    const keys = batch.map((id) => manifestObjectKey(id));
                    const results = await client.removeObjects(bucket, keys);
                    const failedKeys = new Set<string>();
                    for (const result of results ?? []) {
                        const err =
                            result &&
                            typeof result === "object" &&
                            "Error" in result &&
                            result.Error
                                ? result.Error
                                : (result as
                                      | { Key?: string; Message?: string }
                                      | null
                                      | undefined);
                        const key = err?.Key;
                        if (key) {
                            failedKeys.add(key);
                            console.error(
                                `MinIO manifest delete failed for ${key}: ${err?.Message ?? "unknown"}`,
                            );
                        }
                    }
                    for (const id of batch) {
                        if (!failedKeys.has(manifestObjectKey(id))) {
                            succeeded.push(id);
                        }
                    }
                } catch (err) {
                    console.error("MinIO manifest batch delete failed:", err);
                }
            }),
        ),
    );

    return succeeded;
}

/**
 * Build MinIO putObject metadata for a blob object.
 * Compressed variants carry Content-Encoding; WebP gets image/webp.
 */
export function objectMetaForPath(
    filePath: string,
    contentType?: string,
    contentEncoding?: string,
): Record<string, string> {
    const meta: Record<string, string> = {};
    if (contentType) {
        meta["Content-Type"] = contentType;
    }
    if (contentEncoding) {
        meta["Content-Encoding"] = contentEncoding;
    }
    return meta;
}

const BUCKET_ENSURE_RETRIES = 5;
const BUCKET_ENSURE_INITIAL_DELAY_MS = 1000;
const BUCKET_ENSURE_MAX_DELAY_MS = 15000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Ensures the shared bucket exists so Caddy's static_s3 plugin can serve files.
 * Retries with exponential backoff to ride out transient network timeouts
 * (e.g. ETIMEDOUT on a flaky link). Non-fatal: if all retries fail, the app
 * still starts — the bucket can be created manually via the MinIO console.
 */
export async function ensureSharedBucket(): Promise<void> {
    const { client, bucket } = getStorageConfig();
    let attempt = 0;
    let delay = BUCKET_ENSURE_INITIAL_DELAY_MS;
    while (true) {
        attempt++;
        try {
            // makeBucket is idempotent — it returns without error if the bucket already exists
            await client.makeBucket(
                bucket,
                process.env.MINIO_REGION ?? "us-east-1",
            );
            console.log(`✅ Shared bucket "${bucket}" ready.`);
            return;
        } catch (err: any) {
            // BucketAlreadyOwnedByYou / BucketAlreadyExists → bucket is fine, continue
            if (
                err?.code === "BucketAlreadyOwnedByYou" ||
                err?.code === "BucketAlreadyExists"
            ) {
                console.log(`ℹ️  Shared bucket "${bucket}" already exists.`);
                return;
            }
            if (attempt < BUCKET_ENSURE_RETRIES) {
                console.warn(
                    `⚠️  Failed to ensure bucket "${bucket}" (attempt ${attempt}/${BUCKET_ENSURE_RETRIES}): ${err?.message ?? err}. Retrying in ${delay}ms`,
                );
                await sleep(delay);
                delay = Math.min(delay * 2, BUCKET_ENSURE_MAX_DELAY_MS);
                continue;
            }
            // Out of retries: log but don't crash — MinIO may still be starting up
            console.warn(
                `⚠️  Could not ensure bucket "${bucket}": ${err?.message ?? err}`,
            );
            console.warn(
                "   Create it manually via the MinIO console at http://localhost:9001",
            );
            return;
        }
    }
}
