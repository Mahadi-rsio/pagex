import { Worker } from 'bullmq'
import { Open } from 'unzipper'
import { existsSync, unlinkSync } from 'fs'
import { minioClient } from './../../../lib/minio.js'
import { type UploadQueueType, UPLOAD_QUEUE } from './../queues/upload.queue.js'
import { log } from 'console'
import { connection } from './../../../lib/redis.js'


const worker = new Worker<UploadQueueType>(UPLOAD_QUEUE, async (job) => {
    const { path, bucket_name } = job.data;
    console.log(`Processing job ${job.id}...`);

    try {
        // জিপ ফাইলটি ওপেন করা (Streaming mode)
        const directory = await Open.file(path);

        for (const file of directory.files) {
            if (file.type === 'File') {
                const fileStream = file.stream();

                // সরাসরি MinIO-তে স্ট্রিম করে দেওয়া
                // বাকেট নাম 'uploads' আগে থেকে তৈরি থাকতে হবে
                await minioClient.putObject(bucket_name, file.path, fileStream);
                console.log(`Uploaded: ${file.path}`);
            }
        }

        // কাজ শেষ হলে টেম্পোরারি ফাইল ডিলিট
        if (existsSync(path)) {
            unlinkSync(path);
        }

        console.log(`Job ${job.id} completed successfully.`);
    } catch (error) {
        console.error(`Job ${job.id} failed:`, error);
        throw error; // যাতে BullMQ আবার রিট্রাই করতে পারে
    }
}, { connection });

worker.on('completed', async () => {
    console.log("Uploaded \n");

})

worker.on('failed', async () => {
    log("upload failed")
})

console.log('Worker is listening for jobs...');

