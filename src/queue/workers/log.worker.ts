import { Job, Worker } from 'bullmq'
import { type LogJobData, LOGS_QUEUE } from '../jobs/log.job.js'
import { processLogs } from '../../utils/pipeline.js'
import { connection } from '../../infrastructure/cache/redis.js'

export const worker = new Worker<LogJobData>(LOGS_QUEUE,
    async (job: Job<LogJobData>) => {
        console.log(`\nIn Queue: Processing Logs`);
        await processLogs(job.data.logs)
        return { success: true }
    },
    { connection, concurrency: 2 }
)

worker.on('completed', async () => {
    console.log(`Logs process completed`);
})

worker.on('failed', async () => {
    console.error("processLogs failed")
})

console.log("log worker running");
