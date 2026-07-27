/**
 * One-off migration: delete all legacy live objects under the `tenant/` prefix.
 * Caddy now serves directly from `blobs/{hash}` via the Redis site_files map.
 *
 * Run once manually:
 *   npx tsx src/scripts/migrate-to-blob-serving.ts
 *
 * Does NOT touch `blobs/` — content-addressed objects are immutable.
 */
import 'dotenv/config'
import { minioClient, SHARED_BUCKET } from '../infrastructure/storage/minio.js'

const TENANT_PREFIX = 'tenant/'
const BATCH_SIZE = 100

async function listTenantObjects(): Promise<string[]> {
    const objects: string[] = []

    await new Promise<void>((resolve, reject) => {
        const stream = minioClient.listObjects(SHARED_BUCKET, TENANT_PREFIX, true)
        stream.on('data', (obj) => {
            if (obj.name) objects.push(obj.name)
        })
        stream.on('end', resolve)
        stream.on('error', reject)
    })

    return objects
}

async function main(): Promise<void> {
    console.log(`Listing objects under ${SHARED_BUCKET}/${TENANT_PREFIX}…`)
    const objects = await listTenantObjects()
    console.log(`Found ${objects.length} object(s) to delete`)

    if (objects.length === 0) {
        console.log('Nothing to delete. Done.')
        return
    }

    let deleted = 0
    for (let i = 0; i < objects.length; i += BATCH_SIZE) {
        const batch = objects.slice(i, i + BATCH_SIZE)
        await minioClient.removeObjects(SHARED_BUCKET, batch)
        deleted += batch.length
        console.log(`Deleted ${deleted}/${objects.length}`)
    }

    console.log(`✅ Migration complete — removed ${deleted} tenant/ object(s)`)
}

main().catch((err) => {
    console.error('Migration failed:', err)
    process.exit(1)
})
