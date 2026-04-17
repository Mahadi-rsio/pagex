import { Open } from 'unzipper'
import { existsSync, unlinkSync } from 'fs'
import { minioClient } from '../infrastructure/storage/minio.js'

export async function processUpload(path: string, bucketName: string): Promise<void> {
    const directory = await Open.file(path)

    for (const file of directory.files) {
        if (file.type === 'File') {
            const fileStream = file.stream()
            await minioClient.putObject(bucketName, file.path, fileStream)
            console.log(`Uploaded: ${file.path}`)
        }
    }

    if (existsSync(path)) {
        unlinkSync(path)
    }
}
