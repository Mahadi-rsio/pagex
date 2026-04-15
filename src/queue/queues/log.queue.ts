import { Queue } from 'bullmq'
import { connection } from './../../../lib/redis.js'

export const LOGS_QUEUE = "LOGS_QUEUE"

export interface PagesQueueType {
    logs: any[]
}

export const queue = new Queue<PagesQueueType>(LOGS_QUEUE, { connection })
