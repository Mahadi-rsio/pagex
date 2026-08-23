import { log } from 'node:console'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import app from './app.js'
import { ensureSharedBucket } from './infrastructure/storage/minio.js'
import { db } from './infrastructure/db/db.js'
import { bootstrapMigrations } from './infrastructure/db/bootstrap-migrations.js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const MIGRATIONS_DIR = path.join(__dirname, '..', 'drizzle')

async function runMigrations() {
    log('[migrate] Running database migrations...')
    // Seed __drizzle_migrations for any migrations already applied via drizzle-kit push
    // or a previous partial run, so that migrate() doesn't re-run them and fail.
    await bootstrapMigrations()
    await migrate(db, { migrationsFolder: MIGRATIONS_DIR, migrationsTable: '__drizzle_migrations', migrationsSchema: 'drizzle' })
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
