import { Worker } from 'bullmq'
import { SYNC_QUEUE } from '../jobs/sync.job.js'
import { syncUsageToDB } from '../../services/sync.service.js'
import { connection } from '../../infrastructure/cache/redis.js'

const sync_worker = new Worker(SYNC_QUEUE,
    async () => {
        await syncUsageToDB()
    },
    { connection }
)

sync_worker.on('completed', async () => {
    console.log(`[SUCCESS] : Log sync in database at [ ${Date.now()} ]`);
})

sync_worker.on('failed', async () => {
    console.log(`[ERROR] : Log sync failed at [ ${Date.now()} ]`)
})

console.log("sync worker running");
