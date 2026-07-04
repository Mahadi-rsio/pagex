import { log } from 'node:console'
import app from './app.js'
import { ensureSharedBucket } from './infrastructure/storage/minio.js'
import { queue as SyncQueue } from './queue/jobs/sync.job.js'
import { SYNC_CRON_PATTERN } from './constants/index.js'

app.listen(3000, async () => {
    log('server started at 3000')

    // Ensure the shared MinIO bucket exists so the caddy plugin can serve files
    await ensureSharedBucket()

    // Schedule the usage sync cron (Redis → PostgreSQL)
    await SyncQueue.add('sync-usage', {},
        {
            jobId: 'sync-logs-cron',
            repeat: {
                pattern: SYNC_CRON_PATTERN,
            },
        }
    )
})
