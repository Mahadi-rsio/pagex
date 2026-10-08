import { getCloudflareContext } from "@opennextjs/cloudflare";
import pLimit from "p-limit";

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

async function getBlobsBucket(): Promise<R2Bucket> {
    const { env } = await getCloudflareContext({ async: true });
    const bucket = (env as CloudflareEnv).BLOBS;
    if (!bucket) {
        throw new Error("BLOBS R2 binding is required");
    }
    return bucket;
}

/**
 * Bulk-delete content-addressed blob objects (`blobs/{hash}`).
 * Batches of 100, concurrency 10 via p-limit.
 * Returns only hashes whose R2 delete succeeded (failed batches/hashes are omitted).
 */
export async function deleteBlobObjects(hashes: string[]): Promise<string[]> {
    if (hashes.length === 0) return [];

    const bucket = await getBlobsBucket();
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
                    await bucket.delete(keys);
                    succeeded.push(...batch);
                } catch (err) {
                    console.error("R2 batch delete failed:", err);
                    // Fall back to per-object deletes so partial success is retained
                    for (const hash of batch) {
                        try {
                            await bucket.delete(blobObjectKey(hash));
                            succeeded.push(hash);
                        } catch (inner) {
                            console.error(
                                `R2 delete failed for ${blobObjectKey(hash)}:`,
                                inner,
                            );
                        }
                    }
                }
            }),
        ),
    );

    return succeeded;
}

/**
 * Store an immutable deployment manifest in R2.
 * Returns "exists" if the object already exists (idempotent finalize).
 */
export async function putManifestIfAbsent(
    deploymentId: string,
    body: Buffer,
    contentHash: string,
): Promise<"created" | "exists"> {
    const bucket = await getBlobsBucket();
    const key = manifestObjectKey(deploymentId);

    const existing = await bucket.head(key);
    if (existing) return "exists";

    const result = await bucket.put(key, body, {
        httpMetadata: {
            contentType: "application/json",
        },
        customMetadata: {
            "x-manifest-hash": contentHash,
        },
        // Create-only: skip write if another request created it first
        onlyIf: { etagDoesNotMatch: "*" },
    });

    // Conditional put returns null when the precondition failed
    if (result === null) return "exists";
    return "created";
}

/** Read a deployment manifest from R2. */
export async function getManifestObject(deploymentId: string): Promise<Buffer> {
    const bucket = await getBlobsBucket();
    const object = await bucket.get(manifestObjectKey(deploymentId));
    if (!object) {
        throw new Error(`Manifest not found: ${deploymentId}`);
    }
    const bytes = await object.arrayBuffer();
    return Buffer.from(bytes);
}

/** Delete manifest objects for permanently removed deployments. */
export async function deleteManifestObjects(
    deploymentIds: string[],
): Promise<string[]> {
    if (deploymentIds.length === 0) return [];

    const bucket = await getBlobsBucket();
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
                    await bucket.delete(keys);
                    succeeded.push(...batch);
                } catch (err) {
                    console.error("R2 manifest batch delete failed:", err);
                    for (const id of batch) {
                        try {
                            await bucket.delete(manifestObjectKey(id));
                            succeeded.push(id);
                        } catch (inner) {
                            console.error(
                                `R2 manifest delete failed for ${manifestObjectKey(id)}:`,
                                inner,
                            );
                        }
                    }
                }
            }),
        ),
    );

    return succeeded;
}

/**
 * Build R2 put options metadata for a blob object.
 * Compressed variants carry Content-Encoding.
 */
export function objectMetaForPath(
    _filePath: string,
    contentType?: string,
    contentEncoding?: string,
): {
    httpMetadata: R2HTTPMetadata;
} {
    const httpMetadata: R2HTTPMetadata = {};
    if (contentType) {
        httpMetadata.contentType = contentType;
    }
    if (contentEncoding) {
        httpMetadata.contentEncoding = contentEncoding;
    }
    return { httpMetadata };
}

/** Check whether an object key exists in the BLOBS bucket. */
export async function objectExists(key: string): Promise<boolean> {
    const bucket = await getBlobsBucket();
    const head = await bucket.head(key);
    return head !== null;
}

/** Upload bytes to an object key (overwrite). */
export async function putObject(
    key: string,
    body: Buffer | ArrayBuffer | Uint8Array | ReadableStream | string,
    meta?: {
        httpMetadata?: R2HTTPMetadata;
        customMetadata?: Record<string, string>;
    },
): Promise<void> {
    const bucket = await getBlobsBucket();
    await bucket.put(key, body, {
        httpMetadata: meta?.httpMetadata,
        customMetadata: meta?.customMetadata,
    });
}

/** Download object bytes; returns null when missing. */
export async function getObjectBuffer(key: string): Promise<Buffer | null> {
    const bucket = await getBlobsBucket();
    const object = await bucket.get(key);
    if (!object) return null;
    return Buffer.from(await object.arrayBuffer());
}
