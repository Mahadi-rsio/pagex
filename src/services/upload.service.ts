import { Open } from 'unzipper'
import { existsSync, unlinkSync } from 'fs'
import { minioClient, SHARED_BUCKET } from '../infrastructure/storage/minio.js'
import { lookup } from 'mime-types'

/**
 * Extracts the uploaded zip and uploads all files into the shared MinIO bucket
 * under the prefix: `{siteId}/{filepath}`
 *
 * The caddy static_s3 plugin resolves: subdomain → site_id → s3://{SHARED_BUCKET}/{siteId}/{filepath}
 */
export async function processUpload(path: string, siteId: string): Promise<void> {
    const directory = await Open.file(path)

    for (const file of directory.files) {
        if (file.type === 'File') {
            const buffer = await file.buffer()
            const s3Key = `${siteId}/${file.path}`
            await minioClient.putObject(SHARED_BUCKET, s3Key, buffer, buffer.length, {
                'Content-Type': lookup(file.path) || 'application/octet-stream'
            })
            console.log(`Uploaded: ${s3Key}`)
        }
    }

    if (existsSync(path)) unlinkSync(path)
}
