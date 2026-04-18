import { Open } from 'unzipper'
import { existsSync, unlinkSync } from 'fs'
import { minioClient } from '../infrastructure/storage/minio.js'
import { lookup } from 'mime-types'

export async function processUpload(path: string, bucketName: string): Promise<void> {
    const directory = await Open.file(path)

    for (const file of directory.files) {
        if (file.type === 'File') {
            const buffer = await file.buffer()
            await minioClient.putObject(bucketName, file.path, buffer, buffer.length, {
                'Content-Type': lookup(file.path) || 'application/octet-stream'
            })
            console.log(`Uploaded: ${file.path}`)
        }
    }

    if (existsSync(path)) unlinkSync(path)
}
