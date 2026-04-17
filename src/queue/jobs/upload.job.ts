import { Queue } from 'bullmq'
import { connection } from '../../infrastructure/cache/redis.js'

export const UPLOAD_QUEUE = "UPLOAD_QUEUE"

export interface UploadJobData {
    path: string;
    bucket_name: string;
}

export const queue = new Queue<UploadJobData>(UPLOAD_QUEUE, { connection })
