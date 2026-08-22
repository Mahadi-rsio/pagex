import { Worker, Job } from 'bullmq'
import { connection } from '../../infrastructure/cache/redis.js'
import { CLOUDISY_CLOUD_BUILDS_DLQ, type FailedBuildJob } from '../jobs/build.queue.js'

const dlqWorker = new Worker<FailedBuildJob>(
    CLOUDISY_CLOUD_BUILDS_DLQ,
    async (job: Job<FailedBuildJob>) => {
        const { buildId, pageId, tenantId, siteId, repoUrl, gitProvider, framework, buildCommand, outputDir, envVars, failureReason, failedAt, attemptsMade, errorType } = job.data

        console.log(`[DLQ] Processing failed build ${buildId} (job ${job.id})`)
        console.log(`[DLQ] Error type: ${errorType}, Attempts: ${attemptsMade}`)
        console.log(`[DLQ] Failed at: ${failedAt}`)
        console.log(`[DLQ] Failure reason: ${failureReason}`)
        console.log(`[DLQ] Page: ${pageId}, Tenant: ${tenantId}, Site: ${siteId}`)
        console.log(`[DLQ] Repo: ${repoUrl}, Provider: ${gitProvider}`)
        
        // In a production system, you would:
        // 1. Send alert/notification to ops team
        // 2. Create a ticket in your issue tracker
        // 3. Store for later analysis/replay
        // 4. Optionally trigger manual review workflow
        
        // For now, just log with full context for debugging
        console.log(`[DLQ] Build ${buildId} permanently failed and logged for review`)
        
        // Never store secrets in DLQ - gitToken is already excluded from FailedBuildJob
    },
    { connection, concurrency: 1 }
)

dlqWorker.on('completed', (job) => {
    console.log(`[DLQ] Processed failed build job ${job.id}`)
})

dlqWorker.on('failed', (job, err) => {
    console.error(`[DLQ] Failed to process DLQ job ${job?.id}:`, err)
})

dlqWorker.on('error', (err) => {
    console.error('[DLQ] Worker error:', err)
})

console.log('DLQ worker running...')