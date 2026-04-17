import { Worker } from 'bullmq'
import { type UploadJobData, UPLOAD_QUEUE } from '../jobs/upload.job.js'
import { processUpload } from '../../services/upload.service.js'
import { connection } from '../../infrastructure/cache/redis.js'

const worker = new Worker<UploadJobData>(UPLOAD_QUEUE, async (job) => {
    const { path, bucket_name } = job.data;
    console.log(`Processing job ${job.id}...`);

    try {
        await processUpload(path, bucket_name)
        console.log(`Job ${job.id} completed successfully.`);
    } catch (error) {
        console.error(`Job ${job.id} failed:`, error);
        throw error;
    }
}, { connection });

worker.on('completed', async () => {
    console.log("Uploaded \n");
})

worker.on('failed', async () => {
    console.log("upload failed")
})

console.log('upload worker running...');
