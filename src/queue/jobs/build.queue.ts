import { Queue } from 'bullmq'
import { connection } from '../../infrastructure/cache/redis.js'

export const CLOUDISY_CLOUD_BUILDS_QUEUE = "cloudisy:cloud-builds"

export interface CloudBuildJob {
    buildId: string;
    pageId: string;
    tenantId: string;
    siteId: string;
    repoUrl: string;
    gitProvider: "github" | "gitlab";
    gitToken: string;
    framework: string;
    buildCommand: string;
    outputDir: string | null;
    envVars: Record<string, string>;
}

export const buildQueue = new Queue<CloudBuildJob>(CLOUDISY_CLOUD_BUILDS_QUEUE, {
    connection,
    defaultJobOptions: {
        attempts: 3,
        backoff: {
            type: 'exponential',
            delay: 5000,
        },
        removeOnComplete: 100,
        removeOnFail: 500,
    },
})
