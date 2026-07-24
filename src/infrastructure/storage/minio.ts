import * as Minio from 'minio';
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

/** Legacy live site prefix: tenant/{siteId}/ — retained for one-off migration scripts. */
export function liveSitePrefix(siteId: string): string {
    return `tenant/${siteId}/`
}

/** Content-addressed blob object key */
export function blobObjectKey(hash: string): string {
    return `blobs/${hash}`
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

/**
 * Ensures the shared bucket exists so Caddy's static_s3 plugin can serve files.
 * Non-fatal: if it fails (e.g. MinIO not ready yet), the app still starts.
 * The bucket can be created manually via the MinIO console at :9001.
 */
export async function ensureSharedBucket(): Promise<void> {
    try {
        // makeBucket is idempotent — it returns without error if the bucket already exists
        await minioClient.makeBucket(SHARED_BUCKET, process.env.MINIO_REGION ?? 'us-east-1')
        console.log(`✅ Shared bucket "${SHARED_BUCKET}" ready.`)
    } catch (err: any) {
        // BucketAlreadyOwnedByYou / BucketAlreadyExists → bucket is fine, continue
        if (err?.code === 'BucketAlreadyOwnedByYou' || err?.code === 'BucketAlreadyExists') {
            console.log(`ℹ️  Shared bucket "${SHARED_BUCKET}" already exists.`)
            return
        }
        // Any other error: log but don't crash — MinIO may still be starting up
        console.warn(`⚠️  Could not ensure bucket "${SHARED_BUCKET}": ${err?.message ?? err}`)
        console.warn('   Create it manually via the MinIO console at http://localhost:9001')
    }
}
