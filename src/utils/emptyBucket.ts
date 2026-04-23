import { minioClient } from "../infrastructure/storage/minio.js"

export async function emptyBucket(bucketName: string) {
    const objects: string[] = []

    await new Promise<void>((resolve, reject) => {
        const stream = minioClient.listObjects(bucketName, '', true)
        stream.on('data', obj => { if (obj.name) objects.push(obj.name) })
        stream.on('end', resolve)
        stream.on('error', reject)
    })

    if (objects.length === 0) return

    await minioClient.removeObjects(bucketName, objects)
}
