import { Queue } from 'bullmq'
import { connection } from '../../infrastructure/cache/redis.js'

export const TURSO_SYNC_QUEUE = 'turso-sync-deployments'

export interface TursoSyncJobData {
    /** blob_tree_sync_outbox.id */
    outboxId: string
}

export const tursoSyncQueue = new Queue<TursoSyncJobData>(TURSO_SYNC_QUEUE, { connection })