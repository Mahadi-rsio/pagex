import { log } from 'node:console'
import app from './app.js'
import { ensureSharedBucket } from './infrastructure/storage/minio.js'

app.listen(3000, async () => {
    log('server started at 3000')

    // Ensure the shared MinIO bucket exists so the caddy plugin can serve files
    await ensureSharedBucket()
})
