import { Queue } from 'bullmq'
import { connection } from '../../infrastructure/cache/redis.js'

export const SYNC_QUEUE = "SYNC_QUEUE"

export interface SyncJobData {
    // no payload needed
}

export const queue = new Queue<SyncJobData>(SYNC_QUEUE, { connection })
