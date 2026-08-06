import * as Minio from 'minio';
import pLimit from 'p-limit'
import 'dotenv/config'


export const minioClient = new Minio.Client({
    endPoint: process.env.MINIO_ENDPOINT!,
    port: parseInt(process.env.MINIO_PORT!) || 9000,
    useSSL: process.env.MINIO_USE_SSL === 'false' ? false : (process.env.MINIO_ENDPOINT !== 'minio' && process.env.MINIO_ENDPOINT !== 'localhost'),
    accessKey: process.env.S3_ACCESS_KEY!,
    secretKey: process.env.S3_SECRET_KEY!,
    // path-style URLs: requests go to minio_server:9000/bucket/key
    // (instead of virtual-host style: bucket.minio_server:9000/key)
    pathStyle: true,
    // Setting region explicitly prevents the SDK from calling getBucketRegionAsync,
    // which internally constructs a virtual-host URL (bucket.endpoint) and fails
    // when the endpoint contains an underscore (e.g. "minio_server").
    region: process.env.MINIO_REGION ?? 'us-east-1',
});

// The single shared bucket used by all tenants.
// Live serving: Caddy resolves path → blob via Redis site_files:{siteId}, then reads blobs/{sha256}
// Blobs:       {SHARED_BUCKET}/blobs/{sha256}
// Legacy:      {SHARED_BUCKET}/tenant/{site_uuid}/{filepath} (removed by migrate-to-blob-serving)
// Must be set via MINIO_BUCKET env var — no default to avoid accidental bucket naming.
if (!process.env.MINIO_BUCKET) {
    throw new Error('MINIO_BUCKET environment variable is required')
}
export const SHARED_BUCKET = process.env.MINIO_BUCKET

/** Content-addressed blob object key */
export function blobObjectKey(hash: string): string {
    return `blobs/${hash}`
}

const BLOB_DELETE_BATCH_SIZE = 100
const BLOB_DELETE_CONCURRENCY = 10

/**
 * Bulk-delete content-addressed blob objects (`blobs/{hash}`).
 * Batches of 100, concurrency 10 via p-limit.
 * Returns only hashes whose MinIO delete succeeded (failed batches/hashes are omitted).
 */
export async function deleteBlobObjects(hashes: string[]): Promise<string[]> {
    if (hashes.length === 0) return []

    const batches: string[][] = []
    for (let i = 0; i < hashes.length; i += BLOB_DELETE_BATCH_SIZE) {
        batches.push(hashes.slice(i, i + BLOB_DELETE_BATCH_SIZE))
    }

    const limit = pLimit(BLOB_DELETE_CONCURRENCY)
    const succeeded: string[] = []

    await Promise.all(
        batches.map((batch) =>
            limit(async () => {
                try {
                    const keys = batch.map((h) => blobObjectKey(h))
                    const results = await minioClient.removeObjects(SHARED_BUCKET, keys)
                    const failedKeys = new Set<string>()
                    for (const result of results ?? []) {
                        // Parser returns DeleteResult.Error entries directly ({ Key, Message, ... });
                        // typings also allow a nested { Error: { Key } } shape — handle both.
                        const err =
                            result && typeof result === 'object' && 'Error' in result && result.Error
                                ? result.Error
                                : (result as { Key?: string; Message?: string } | null | undefined)
                        const key = err?.Key
                        if (key) {
                            failedKeys.add(key)
                            console.error(`MinIO delete failed for ${key}: ${err?.Message ?? 'unknown'}`)
                        }
                    }
                    for (const hash of batch) {
                        if (!failedKeys.has(blobObjectKey(hash))) {
                            succeeded.push(hash)
                        }
                    }
                } catch (err) {
                    console.error('MinIO batch delete failed:', err)
                    // Do not mark any hash in this batch as succeeded
                }
            })
        )
    )

    return succeeded
}

/**
 * Build MinIO putObject metadata for a blob object.
 * Compressed variants carry Content-Encoding; WebP gets image/webp.
 */
export function objectMetaForPath(
    filePath: string,
    contentType?: string,
    contentEncoding?: string
): Record<string, string> {
    const meta: Record<string, string> = {}
    if (contentType) {
        meta['Content-Type'] = contentType
    }
    if (contentEncoding) {
        meta['Content-Encoding'] = contentEncoding
    }
    return meta
}

const BUCKET_ENSURE_RETRIES = 5
const BUCKET_ENSURE_INITIAL_DELAY_MS = 1000
const BUCKET_ENSURE_MAX_DELAY_MS = 15000

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Ensures the shared bucket exists so Caddy's static_s3 plugin can serve files.
 * Retries with exponential backoff to ride out transient network timeouts
 * (e.g. ETIMEDOUT on a flaky link). Non-fatal: if all retries fail, the app
 * still starts — the bucket can be created manually via the MinIO console.
 */
export async function ensureSharedBucket(): Promise<void> {
    let attempt = 0
    let delay = BUCKET_ENSURE_INITIAL_DELAY_MS
    while (true) {
        attempt++
        try {
            // makeBucket is idempotent — it returns without error if the bucket already exists
            await minioClient.makeBucket(SHARED_BUCKET, process.env.MINIO_REGION ?? 'us-east-1')
            console.log(`✅ Shared bucket "${SHARED_BUCKET}" ready.`)
            return
        } catch (err: any) {
            // BucketAlreadyOwnedByYou / BucketAlreadyExists → bucket is fine, continue
            if (err?.code === 'BucketAlreadyOwnedByYou' || err?.code === 'BucketAlreadyExists') {
                console.log(`ℹ️  Shared bucket "${SHARED_BUCKET}" already exists.`)
                return
            }
            if (attempt < BUCKET_ENSURE_RETRIES) {
                console.warn(
                    `⚠️  Failed to ensure bucket "${SHARED_BUCKET}" (attempt ${attempt}/${BUCKET_ENSURE_RETRIES}): ${err?.message ?? err}. Retrying in ${delay}ms`
                )
                await sleep(delay)
                delay = Math.min(delay * 2, BUCKET_ENSURE_MAX_DELAY_MS)
                continue
            }
            // Out of retries: log but don't crash — MinIO may still be starting up
            console.warn(`⚠️  Could not ensure bucket "${SHARED_BUCKET}": ${err?.message ?? err}`)
            console.warn('   Create it manually via the MinIO console at http://localhost:9001')
            return
        }
    }
}
