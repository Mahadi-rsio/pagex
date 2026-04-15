import { Queue } from 'bullmq'
import { connection } from './../../../lib/redis.js'

export const SYNC_QUEUE = "SYNC_QUEUE"

export interface SyncQueueType {

}

export const queue = new Queue<SyncQueueType>(SYNC_QUEUE, { connection })
