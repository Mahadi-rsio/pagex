import { Worker } from 'bullmq'
import { SYNC_QUEUE } from './../queues/sync.queue.js'
import { syncUsageToDB } from './../../helpers/sync.database.js'
import { connection } from './../../../lib/redis.js'

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
