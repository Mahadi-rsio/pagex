import { Queue } from 'bullmq'
import { connection } from '../../infrastructure/cache/redis.js'

export const LOGS_QUEUE = "LOGS_QUEUE"

export interface LogJobData {
    logs: any[]
}

export const queue = new Queue<LogJobData>(LOGS_QUEUE, { connection })
