import { Queue } from 'bullmq'
import { connection } from '../../infrastructure/cache/redis.js'

export const UPLOAD_QUEUE = "UPLOAD_QUEUE"

export interface UploadJobData {
    path: string;
    // UUID from the `sites` table; used as the key prefix in the shared MinIO bucket.
    site_id: string;
}

export const queue = new Queue<UploadJobData>(UPLOAD_QUEUE, { connection })
