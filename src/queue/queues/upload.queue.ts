import { Queue } from 'bullmq'
import { connection } from './../../../lib/redis.js'

export const UPLOAD_QUEUE = "UPLOAD_QUEUE"

export interface UploadQueueType {
    path: string;
    bucket_name: string;
}

export const queue = new Queue<UploadQueueType>(UPLOAD_QUEUE, { connection })
