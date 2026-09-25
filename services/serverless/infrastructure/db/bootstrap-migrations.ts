/**
 * Migration bootstrap utility.
 *
 * Handles the case where the database schema was applied via `drizzle-kit push`
 * (or a previous partial migration run) without updating the `__drizzle_migrations`
 * tracking table. Without this, `drizzle-orm migrate()` re-runs already-applied
 * migrations and fails on duplicate table/index creation.
 *
 * Logic:
 *  1. If `__drizzle_migrations` doesn't exist at all → fresh DB, let migrate() handle it.
 *  2. If `__drizzle_migrations` exists but is missing entries that are in the journal
 *     → seed those missing entries so migrate() skips them.
 */

import fs from 'node:fs'
import crypto from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { dbClient } from './db.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// Walk up from infrastructure/db → api root → drizzle/ (3 levels: dist/infrastructure/db → dist/infrastructure → dist → api root)
const MIGRATIONS_DIR = path.resolve(__dirname, '..', '..', '..', 'drizzle')

interface JournalEntry {
  idx: number
  tag: string
  when: number
  breakpoints: boolean
}

interface Journal {
  entries: JournalEntry[]
}

export async function bootstrapMigrations(): Promise<void> {
  const journalPath = path.join(MIGRATIONS_DIR, 'meta', '_journal.json')
  if (!fs.existsSync(journalPath)) {
    throw new Error(`[migrate] Cannot find journal at ${journalPath}`)
  }

  const journal: Journal = JSON.parse(fs.readFileSync(journalPath, 'utf8'))

  // Check if the tracking table exists
  const trackingResult = await dbClient`
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'drizzle'
      AND table_name = '__drizzle_migrations'
  `

  if (trackingResult.length === 0) {
    // No tracking table at all — check whether the schema was already pushed
    const schemaResult = await dbClient`
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = 'sites'
    `

    if (schemaResult.length === 0) {
      // Truly fresh DB — let drizzle-orm migrate() create everything from scratch
      console.log('[migrate] Fresh database — skipping bootstrap.')
      return
    }

    // Schema exists but no tracking table — this was a drizzle-kit push DB.
    // Create the tracking table and seed all journal entries.
    console.log('[migrate] Schema applied via push, no tracking table — creating and seeding __drizzle_migrations...')

    await dbClient`CREATE SCHEMA IF NOT EXISTS drizzle`
    await dbClient`
      CREATE TABLE IF NOT EXISTS drizzle."__drizzle_migrations" (
        id serial PRIMARY KEY,
        hash text NOT NULL,
        created_at bigint
      )
    `

    await _seedMissingEntries(journal, [])
    console.log('[migrate] Bootstrap complete.')
    return
  }

  // Tracking table exists — find which journal entries are missing
  const appliedRows = await dbClient`
    SELECT hash FROM drizzle."__drizzle_migrations" ORDER BY id
  `
  const appliedHashes = new Set(appliedRows.map((r) => String(r['hash'])))

  const missingEntries: JournalEntry[] = journal.entries.filter((entry) => {
    const sqlPath = path.join(MIGRATIONS_DIR, `${entry.tag}.sql`)
    if (!fs.existsSync(sqlPath)) return false
    const sql = fs.readFileSync(sqlPath, 'utf8')
    const hash = crypto.createHash('sha256').update(sql).digest('hex')
    return !appliedHashes.has(hash)
  })

  if (missingEntries.length === 0) {
    console.log('[migrate] __drizzle_migrations is up to date — no bootstrap needed.')
    return
  }

  console.log(`[migrate] Found ${missingEntries.length} migration(s) missing from __drizzle_migrations — checking DB state...`)

  // For each missing entry, check if its first table/index already exists in the DB.
  // If the DDL was already applied, seed the tracking record to skip it.
  // If not applied, leave it for migrate() to run normally.
  const toSeed: JournalEntry[] = []

  for (const entry of missingEntries) {
    const alreadyApplied = await _isMigrationAlreadyApplied(entry)
    if (alreadyApplied) {
      toSeed.push(entry)
      console.log(`[migrate]   → ${entry.tag}: already applied, will seed tracking record`)
    } else {
      console.log(`[migrate]   → ${entry.tag}: not yet applied, migrate() will run it`)
    }
  }

  if (toSeed.length > 0) {
    await _seedMissingEntries(journal, toSeed.map(e => e.tag))
    console.log('[migrate] Bootstrap seeding complete.')
  }
}

async function _seedMissingEntries(journal: Journal, onlyTags: string[]): Promise<void> {
  const entriesToSeed = onlyTags.length === 0
    ? journal.entries
    : journal.entries.filter(e => onlyTags.includes(e.tag))

  for (const entry of entriesToSeed) {
    const sqlPath = path.join(MIGRATIONS_DIR, `${entry.tag}.sql`)
    if (!fs.existsSync(sqlPath)) {
      console.warn(`[migrate] Warning: SQL file not found for ${entry.tag}, skipping seed`)
      continue
    }
    const sql = fs.readFileSync(sqlPath, 'utf8')
    const hash = crypto.createHash('sha256').update(sql).digest('hex')

    await dbClient`
      INSERT INTO drizzle."__drizzle_migrations" (hash, created_at)
      VALUES (${hash}, ${entry.when})
      ON CONFLICT DO NOTHING
    `
    console.log(`[migrate]   ✓ seeded ${entry.tag} (${hash.slice(0, 12)}...)`)
  }
}

/**
 * Heuristic: check if a migration's DDL was already applied by probing for
 * a known object it creates. Falls back to assuming not applied if we can't tell.
 *
 * Only needs to cover migrations that could be partially applied — in practice
 * this is any migration newer than the last tracked one.
 */
async function _isMigrationAlreadyApplied(entry: JournalEntry): Promise<boolean> {
  const sqlPath = path.join(MIGRATIONS_DIR, `${entry.tag}.sql`)
  const sql = fs.readFileSync(sqlPath, 'utf8')

  // Extract the first CREATE TABLE name from the migration
  const createTableMatch = sql.match(/CREATE TABLE\s+(?:IF NOT EXISTS\s+)?"?(\w+)"?/i)
  if (createTableMatch) {
    const tableName = createTableMatch[1] ?? ''
    const result = await dbClient`
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = ${tableName}
    `
    return result.length > 0
  }

  // Extract first ALTER TABLE (no new table created — check for column/index existence)
  const alterTableMatch = sql.match(/ALTER TABLE\s+"?(\w+)"?\s+ADD COLUMN\s+"?(\w+)"?/i)
  if (alterTableMatch) {
    const tableName = alterTableMatch[1] ?? ''
    const columnName = alterTableMatch[2] ?? ''
    const result = await dbClient`
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = ${tableName}
        AND column_name = ${columnName}
    `
    return result.length > 0
  }

  // CREATE INDEX / CREATE UNIQUE INDEX
  const createIndexMatch = sql.match(/CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF NOT EXISTS\s+)?"?(\w+)"?/i)
  if (createIndexMatch) {
    const indexName = createIndexMatch[1] ?? ''
    const result = await dbClient`
      SELECT 1 FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname = ${indexName}
    `
    return result.length > 0
  }

  // Cannot determine — assume not applied (safe default; migrate() will try and may fail)
  console.warn(`[migrate] Warning: cannot determine if ${entry.tag} was applied — leaving for migrate()`)
  return false
}
