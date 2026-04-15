import { Queue } from 'bullmq'

export const PAGES_QUEUE = "pages_queue"

export interface PagesQueueType {
    logs: any[]
}

export const connection = {
    host: "redis",
    port: 6379
}

export const queue = new Queue<PagesQueueType>(PAGES_QUEUE, { connection })
