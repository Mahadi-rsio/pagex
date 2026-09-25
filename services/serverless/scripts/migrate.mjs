#!/usr/bin/env node
/**
 * Migration bootstrap script.
 *
 * Problem: The database was initially seeded via `drizzle-kit push`, which
 * does NOT create the `__drizzle_migrations` tracking table. When
 * `drizzle-kit migrate` runs afterwards it tries to re-apply all migrations
 * from scratch, colliding with existing tables and exiting with code 1.
 *
 * Additionally, `drizzle-kit migrate` with a TypeScript config has a known
 * issue where it always exits with code 1 (the tsx child process doesn't
 * terminate cleanly). We avoid that entirely by using drizzle-orm's
 * programmatic `migrate()` function instead.
 */

import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import path from 'path';
import 'dotenv/config';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, '..', 'drizzle');

const connectionString = process.env.DRIZZLE_CONNECTION;
if (!connectionString) {
  console.error('ERROR: DRIZZLE_CONNECTION environment variable is not set');
  process.exit(1);
}

const pool = new pg.Pool({ connectionString });

async function bootstrap() {
  const client = await pool.connect();

  try {
    // Check if drizzle migrations tracking table already exists
    const { rows: trackingRows } = await client.query(`
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = '__drizzle_migrations'
    `);

    if (trackingRows.length > 0) {
      console.log('[migrate] __drizzle_migrations table exists — no bootstrap needed.');
      return;
    }

    // Check if the schema was already applied (e.g., via drizzle-kit push)
    const { rows: schemaRows } = await client.query(`
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = 'sites'
    `);

    if (schemaRows.length === 0) {
      console.log('[migrate] Fresh database — drizzle-orm migrate will apply all migrations.');
      return;
    }

    // Schema exists but tracking table doesn't — seed it
    console.log('[migrate] Schema already applied via push — seeding __drizzle_migrations tracking table...');

    // Create the tracking table (matches drizzle-orm node-postgres migrator schema)
    await client.query(`
      CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (
        id serial PRIMARY KEY,
        hash text NOT NULL,
        created_at bigint
      )
    `);

    // Read journal to get the ordered list of migrations
    const journalPath = path.join(MIGRATIONS_DIR, 'meta', '_journal.json');
    const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8'));

    for (const entry of journal.entries) {
      const sqlPath = path.join(MIGRATIONS_DIR, `${entry.tag}.sql`);
      const sql = fs.readFileSync(sqlPath, 'utf8');
      const hash = crypto.createHash('sha256').update(sql).digest('hex');

      await client.query(
        'INSERT INTO "__drizzle_migrations" (hash, created_at) VALUES ($1, $2)',
        [hash, entry.when]
      );
      console.log(`[migrate]   ✓ marked ${entry.tag} (${hash.slice(0, 12)}...)`);
    }

    console.log('[migrate] Bootstrap complete — all migrations marked as applied.');
  } finally {
    client.release();
  }
}

async function runMigrations() {
  await bootstrap();

  console.log('[migrate] Running drizzle-orm migrate...');
  const db = drizzle(pool);
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  console.log('[migrate] All migrations applied successfully.');
}

runMigrations()
  .then(async () => {
    await pool.end();
    console.log('[migrate] Done.');
    process.exit(0);
  })
  .catch(async (err) => {
    console.error('[migrate] FATAL:', err.message);
    await pool.end().catch(() => {});
    process.exit(1);
  });
