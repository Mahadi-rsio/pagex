import { Open } from 'unzipper'
import { existsSync, unlinkSync } from 'fs'
import { minioClient, SHARED_BUCKET } from '../infrastructure/storage/minio.js'
import { lookup } from 'mime-types'
import { executeDeploymentFlow } from './deployment.service.js'

/**
 * Extracts the uploaded zip and uploads all files into the shared MinIO bucket
 * under the prefix: `{siteId}/{filepath}` via the executeDeploymentFlow lifecycle.
 */
export async function processUpload(path: string, siteId: string, pageId: string, tenantId: string): Promise<void> {
    await executeDeploymentFlow(
        pageId,
        tenantId,
        siteId,
        'upload',
        null,
        async () => {
            const directory = await Open.file(path)
            let fileCount = 0

            for (const file of directory.files) {
                if (file.type === 'File') {
                    const buffer = await file.buffer()
                    const s3Key = `${siteId}/${file.path}`
                    await minioClient.putObject(SHARED_BUCKET, s3Key, buffer, buffer.length, {
                        'Content-Type': lookup(file.path) || 'application/octet-stream'
                    })
                    console.log(`Uploaded: ${s3Key}`)
                    fileCount++
                }
            }

            if (existsSync(path)) unlinkSync(path)
            return fileCount
        }
    )
}
