import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { getPool } from "@/db";

interface JournalEntry {
    idx: number;
    tag: string;
    when: number;
    breakpoints: boolean;
}

interface Journal {
    entries: JournalEntry[];
}

function assertSafeIdent(value: string): string {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
        throw new Error(`Unsafe SQL identifier: ${value}`);
    }
    return value;
}

function migrationHash(migrationsFolder: string, entry: JournalEntry) {
    const sql = fs.readFileSync(
        path.join(migrationsFolder, `${entry.tag}.sql`),
        "utf8",
    );
    return crypto.createHash("sha256").update(sql).digest("hex");
}

async function isMigrationApplied(
    migrationsFolder: string,
    entry: JournalEntry,
): Promise<boolean> {
    const pool = getPool();
    const sql = fs.readFileSync(
        path.join(migrationsFolder, `${entry.tag}.sql`),
        "utf8",
    );
    const createTable = sql.match(
        /CREATE TABLE\s+(?:IF NOT EXISTS\s+)?"?(\w+)"?/i,
    );
    if (createTable?.[1]) {
        const { rows } = await pool.query(
            `SELECT 1
             FROM information_schema.tables
             WHERE table_schema = 'public'
               AND table_name = $1`,
            [createTable[1]],
        );
        return rows.length > 0;
    }

    const addColumn = sql.match(
        /ALTER TABLE\s+"?(\w+)"?\s+ADD COLUMN\s+"?(\w+)"?/i,
    );
    if (addColumn?.[1] && addColumn[2]) {
        const { rows } = await pool.query(
            `SELECT 1
             FROM information_schema.columns
             WHERE table_schema = 'public'
               AND table_name = $1
               AND column_name = $2`,
            [addColumn[1], addColumn[2]],
        );
        return rows.length > 0;
    }

    const createIndex = sql.match(
        /CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF NOT EXISTS\s+)?"?(\w+)"?/i,
    );
    if (createIndex?.[1]) {
        const { rows } = await pool.query(
            `SELECT 1
             FROM pg_indexes
             WHERE schemaname = 'public'
               AND indexname = $1`,
            [createIndex[1]],
        );
        return rows.length > 0;
    }

    return false;
}

async function seedEntries(
    migrationsFolder: string,
    entries: JournalEntry[],
    migrationsTable: string,
) {
    const pool = getPool();
    const table = assertSafeIdent(migrationsTable);
    for (const entry of entries) {
        const hash = migrationHash(migrationsFolder, entry);
        await pool.query(
            `INSERT INTO drizzle.${table}
                (hash, created_at)
             VALUES ($1, $2)
             ON CONFLICT DO NOTHING`,
            [hash, entry.when],
        );
    }
}

export async function bootstrapApiMigrations(
    migrationsFolder: string,
    migrationsTable: string,
) {
    const journalPath = path.join(migrationsFolder, "meta", "_journal.json");
    if (!fs.existsSync(journalPath)) {
        throw new Error(`[migrate] Cannot find journal at ${journalPath}`);
    }

    const pool = getPool();
    const table = assertSafeIdent(migrationsTable);
    const journal = JSON.parse(fs.readFileSync(journalPath, "utf8")) as Journal;
    const tracking = await pool.query(
        `SELECT 1
         FROM information_schema.tables
         WHERE table_schema = 'drizzle'
           AND table_name = $1`,
        [migrationsTable],
    );

    if (tracking.rows.length === 0) {
        const siteRows = await pool.query(
            `SELECT 1
             FROM information_schema.tables
             WHERE table_schema = 'public'
               AND table_name = 'sites'`,
        );
        if (siteRows.rows.length === 0) return;

        await pool.query(`CREATE SCHEMA IF NOT EXISTS drizzle`);
        await pool.query(
            `CREATE TABLE IF NOT EXISTS drizzle.${table} (
                id serial PRIMARY KEY,
                hash text NOT NULL,
                created_at bigint
            )`,
        );
        await seedEntries(migrationsFolder, journal.entries, migrationsTable);
        return;
    }

    const appliedRows = await pool.query(
        `SELECT hash
         FROM drizzle.${table}
         ORDER BY id`,
    );
    const appliedHashes = new Set(
        appliedRows.rows.map((row) => String(row["hash"])),
    );
    const missingEntries = journal.entries.filter(
        (entry) =>
            fs.existsSync(path.join(migrationsFolder, `${entry.tag}.sql`)) &&
            !appliedHashes.has(migrationHash(migrationsFolder, entry)),
    );
    const appliedEntries: JournalEntry[] = [];

    for (const entry of missingEntries) {
        if (await isMigrationApplied(migrationsFolder, entry)) {
            appliedEntries.push(entry);
        }
    }

    if (appliedEntries.length > 0) {
        await seedEntries(migrationsFolder, appliedEntries, migrationsTable);
    }
}
