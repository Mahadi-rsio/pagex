import { Job, Worker } from 'bullmq'
import { PagesQueueType, connection, PAGES_QUEUE } from './../queues/queue.js'
import { processLogs } from './../../src/helpers/pipeline.js'

export const worker = new Worker<PagesQueueType>(PAGES_QUEUE,
    async (job: Job<PagesQueueType>) => {
        await toDoHandler(job.data.logs)
        return { success: true }
    },
    { connection, concurrency: 2 }
)

async function toDoHandler(logs: any[]) {
    console.log(`\nIn Queue: Processing Logs`);
    await processLogs(logs)

}

worker.on('completed', async () => {
    console.log(`Logs process completed`);
})

worker.on('failed', async () => {
    console.error("processLogs failed")
})

console.log("worker running");

