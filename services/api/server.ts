import { log } from 'node:console'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import app from './app.js'
import { ensureSharedBucket } from './infrastructure/storage/minio.js'
import { db } from './infrastructure/db/db.js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const MIGRATIONS_DIR = path.join(__dirname, '..', 'drizzle')

async function runMigrations() {
    log('[migrate] Running database migrations...')
    await migrate(db, { migrationsFolder: MIGRATIONS_DIR })
    log('[migrate] Migrations complete.')
}

runMigrations()
    .then(() => {
        app.listen(3000, async () => {
            log('server started at 3000')

            // Ensure the shared MinIO bucket exists so the caddy plugin can serve files
            await ensureSharedBucket()
        })
    })
    .catch((err) => {
        log('[migrate] FATAL: Migration failed —', err.message)
        process.exit(1)
    })
