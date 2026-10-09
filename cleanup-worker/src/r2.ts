import {
    BLOB_DELETE_BATCH_SIZE,
    BLOB_DELETE_CONCURRENCY,
    blobObjectKey,
    manifestObjectKey,
} from "./config";

async function mapLimit<T, R>(
    items: readonly T[],
    concurrency: number,
    fn: (item: T) => Promise<R>,
): Promise<R[]> {
    const results = new Array<R>(items.length);
    let next = 0;
    async function worker() {
        while (true) {
            const index = next++;
            if (index >= items.length) return;
            results[index] = await fn(items[index]!);
        }
    }
    await Promise.all(Array.from({ length: concurrency }, () => worker()));
    return results;
}

/**
 * Delete a batch of objects, falling back to per-object deletes on partial
 * failure so successes are retained. Returns the keys whose delete completed.
 */
async function deleteBatch(
    bucket: R2Bucket,
    keys: readonly string[],
): Promise<string[]> {
    try {
        await bucket.delete(keys as string[]);
        return [...keys];
    } catch (err) {
        console.error("R2 batch delete failed:", err);
        const done: string[] = [];
        for (const key of keys) {
            try {
                await bucket.delete(key);
                done.push(key);
            } catch (inner) {
                console.error(`R2 delete failed for ${key}:`, inner);
            }
        }
        return done;
    }
}

/**
 * Bulk-delete content-addressed blob objects (`blobs/{hash}`).
 * Batches of 100, concurrency 10.
 * Returns only hashes whose R2 delete succeeded (failed batches/hashes are omitted).
 */
export async function deleteBlobObjects(
    bucket: R2Bucket,
    hashes: readonly string[],
): Promise<string[]> {
    if (hashes.length === 0) return [];
    return deleteObjects(bucket, hashes, blobObjectKey);
}

/** Delete immutable manifest objects for permanently removed deployments. */
export async function deleteManifestObjects(
    bucket: R2Bucket,
    deploymentIds: readonly string[],
): Promise<string[]> {
    if (deploymentIds.length === 0) return [];
    return deleteObjects(bucket, deploymentIds, manifestObjectKey);
}

async function deleteObjects(
    bucket: R2Bucket,
    ids: readonly string[],
    toKey: (id: string) => string,
): Promise<string[]> {
    const batches: string[][] = [];
    for (let i = 0; i < ids.length; i += BLOB_DELETE_BATCH_SIZE) {
        batches.push(ids.slice(i, i + BLOB_DELETE_BATCH_SIZE));
    }

    const okKeys = new Set<string>();
    await mapLimit(batches, BLOB_DELETE_CONCURRENCY, async (batch) => {
        const keys = batch.map(toKey);
        for (const key of await deleteBatch(bucket, keys)) {
            okKeys.add(key);
        }
    });

    // Preserve input order; include only ids whose R2 delete succeeded.
    return ids.filter((id) => okKeys.has(toKey(id)));
}

/** Store an immutable deployment manifest in R2 (create-only). */
export async function putManifestIfAbsent(
    bucket: R2Bucket,
    deploymentId: string,
    body: Buffer,
    contentHash: string,
): Promise<"created" | "exists"> {
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

/** Read a deployment manifest from R2. Throws when missing. */
export async function getManifestObject(
    bucket: R2Bucket,
    deploymentId: string,
): Promise<Buffer> {
    const object = await bucket.get(manifestObjectKey(deploymentId));
    if (!object) {
        throw new Error(`Manifest not found: ${deploymentId}`);
    }
    const bytes = await object.arrayBuffer();
    return Buffer.from(bytes);
}

/** Check whether an object key exists in the BLOBS bucket. */
export async function objectExists(
    bucket: R2Bucket,
    key: string,
): Promise<boolean> {
    const head = await bucket.head(key);
    return head !== null;
}

/** Download object bytes; returns null when missing. */
export async function getObjectBuffer(
    bucket: R2Bucket,
    key: string,
): Promise<Buffer | null> {
    const object = await bucket.get(key);
    if (!object) return null;
    return Buffer.from(await object.arrayBuffer());
}
