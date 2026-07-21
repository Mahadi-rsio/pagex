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
// Files are stored at: {SHARED_BUCKET}/tenant/{site_uuid}/{filepath}
// Must be set via MINIO_BUCKET env var — no default to avoid accidental bucket naming.
if (!process.env.MINIO_BUCKET) {
    throw new Error('MINIO_BUCKET environment variable is required')
}
export const SHARED_BUCKET = process.env.MINIO_BUCKET

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

/**
 * Removes all live and snapshot objects under the given `siteId` in the shared bucket.
 * Used when deleting a project.
 */
export async function deleteSiteObjects(siteId: string): Promise<void> {
    await deleteFolder(`${siteId}/`)
    await deleteFolder(`snapshots/${siteId}/`)
    console.log(`🗑️  Removed live and snapshot objects for site ${siteId}`)
}

/**
 * Server-side copy of all files under a source prefix to a destination prefix.
 */
export async function copyFolder(sourcePrefix: string, destPrefix: string): Promise<number> {
    const objects: string[] = []
    await new Promise<void>((resolve, reject) => {
        const stream = minioClient.listObjects(SHARED_BUCKET, sourcePrefix, true)
        stream.on('data', obj => { if (obj.name) objects.push(obj.name) })
        stream.on('end', resolve)
        stream.on('error', reject)
    })

    let count = 0
    for (const objName of objects) {
        const relativePath = objName.substring(sourcePrefix.length)
        const destKey = `${destPrefix}${relativePath}`
        await minioClient.copyObject(SHARED_BUCKET, destKey, `/${SHARED_BUCKET}/${objName}`)
        count++
    }
    return count
}

/**
 * Removes all objects under the given prefix in the shared bucket.
 */
export async function deleteFolder(prefix: string): Promise<void> {
    const objects: string[] = []
    await new Promise<void>((resolve, reject) => {
        const stream = minioClient.listObjects(SHARED_BUCKET, prefix, true)
        stream.on('data', obj => { if (obj.name) objects.push(obj.name) })
        stream.on('end', resolve)
        stream.on('error', reject)
    })

    if (objects.length === 0) return

    await minioClient.removeObjects(SHARED_BUCKET, objects)
}
