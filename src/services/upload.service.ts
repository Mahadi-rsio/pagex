import { Open } from 'unzipper'
import { existsSync, unlinkSync } from 'fs'
import { minioClient } from '../infrastructure/storage/minio.js'
import { lookup } from 'mime-types'

export async function processUpload(path: string, bucketName: string): Promise<void> {
    const directory = await Open.file(path)

    for (const file of directory.files) {
        if (file.type === 'File') {
            const fileStream = file.stream()
            const contentType = lookup(file.path) || 'application/octet-stream'

            await minioClient.putObject(bucketName, file.path, fileStream, -1, {
                'Content-Type': contentType
            })
            console.log(`Uploaded: ${file.path} (${contentType})`)
        }
    }

    if (existsSync(path)) {
        unlinkSync(path)
    }
}
