import { Queue, QueueEvents } from 'bullmq'
import { connection } from '../../infrastructure/cache/redis.js'

export const CLOUDISY_CLOUD_BUILDS_QUEUE = "cloudisy-cloud-builds"
export const CLOUDISY_CLOUD_BUILDS_DLQ = "cloudisy-cloud-builds-dlq"

export interface CloudBuildJob {
    buildId: string;
    pageId: string;
    tenantId: string;
    siteId: string;
    repoUrl: string;
    gitProvider: "github" | "gitlab";
    gitToken?: string;
    framework: string;
    buildCommand: string;
    outputDir: string | null;
    envVars: Record<string, string>;
}

export interface FailedBuildJob extends CloudBuildJob {
    failureReason: string;
    failedAt: string;
    attemptsMade: number;
    errorType: 'retryable' | 'permanent';
}

/**
 * Classify error as retryable or permanent
 */
export function classifyBuildError(error: Error): 'retryable' | 'permanent' {
    const message = error.message.toLowerCase()
    
    // Retryable errors - transient failures
    const retryablePatterns = [
        'econnrefused',
        'etimedout',
        'enotfound',
        'socket hang up',
        'network error',
        'timeout',
        'connection refused',
        'connection reset',
        'temporary failure',
        'minio: connection',
        'redis: connection',
        'postgres: connection',
        'docker: connection',
        'git clone failed',
        'git fetch failed',
        'git push failed',
    ]
    
    // Permanent errors - configuration/build errors that won't succeed on retry
    const permanentPatterns = [
        'invalid repo',
        'repository not found',
        'authentication failed',
        'permission denied',
        'invalid token',
        'build command failed',
        'output directory not found',
        'no files found in output',
        'validation failed',
        'blocked file',
        'exceeds limit',
        'manifest validation',
        'invalid framework',
    ]
    
    for (const pattern of permanentPatterns) {
        if (message.includes(pattern)) {
            return 'permanent'
        }
    }
    
    for (const pattern of retryablePatterns) {
        if (message.includes(pattern)) {
            return 'retryable'
        }
    }
    
    // Default to retryable for unknown errors (safer)
    return 'retryable'
}

export const buildQueue = new Queue<CloudBuildJob, unknown, 'build-job'>(CLOUDISY_CLOUD_BUILDS_QUEUE, {
    connection,
    defaultJobOptions: {
        attempts: 3,
        backoff: {
            type: 'exponential',
            delay: 10000, // 10s base delay
        },
        removeOnComplete: 100,
        removeOnFail: 0, // Keep failed jobs for DLQ processing
    },
})

export const buildDlqQueue = new Queue<FailedBuildJob, unknown, 'failed-build'>('failed-build', {
    connection,
    defaultJobOptions: {
        attempts: 1,
        removeOnComplete: 1000,
        removeOnFail: 1000,
    },
})

// Queue events for monitoring
export const buildQueueEvents = new QueueEvents(CLOUDISY_CLOUD_BUILDS_QUEUE, { connection })
export const buildDlqQueueEvents = new QueueEvents(CLOUDISY_CLOUD_BUILDS_DLQ, { connection })

/**
 * Move a failed job to DLQ with classification
 */
export async function moveToDLQ(
    job: { id: string; data: CloudBuildJob; attemptsMade: number; failedReason: string },
    error: Error
): Promise<void> {
    const errorType = classifyBuildError(error)
    
    await buildDlqQueue.add('failed-build', {
        ...job.data,
        failureReason: job.failedReason,
        failedAt: new Date().toISOString(),
        attemptsMade: job.attemptsMade,
        errorType,
    })
}