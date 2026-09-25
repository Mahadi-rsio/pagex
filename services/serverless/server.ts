import { log } from 'node:console'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { serve } from '@hono/node-server'
import app from './app.js'
import { ensureSharedBucket } from './infrastructure/storage/minio.js'
import { db } from './infrastructure/db/db.js'
import { bootstrapMigrations } from './infrastructure/db/bootstrap-migrations.js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// Source (tsx): drizzle/ is a sibling of server.ts. Compiled (dist/): a sibling of dist/.
let MIGRATIONS_DIR = path.join(__dirname, 'drizzle')
if (!fs.existsSync(path.join(MIGRATIONS_DIR, 'meta', '_journal.json'))) {
    MIGRATIONS_DIR = path.resolve(__dirname, '..', 'drizzle')
}

async function runMigrations() {
    log('[migrate] Running database migrations...')
    // Seed __drizzle_migrations for any migrations already applied via drizzle-kit push
    // or a previous partial run, so that migrate() doesn't re-run them and fail.
    await bootstrapMigrations()
    await migrate(db, { migrationsFolder: MIGRATIONS_DIR, migrationsTable: '__drizzle_migrations', migrationsSchema: 'drizzle' })
    log('[migrate] Migrations complete.')
}

runMigrations()
    .then(async () => {
        await ensureSharedBucket()
        serve({ fetch: app.fetch, port: 3000 }, (info) => {
            log(`server started at ${info.port}`)
        })
    })
    .catch((err) => {
        log('[migrate] FATAL: Migration failed —', err.message)
        process.exit(1)
    })