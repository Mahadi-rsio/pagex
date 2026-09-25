import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { dbClient } from "./db";

interface JournalEntry {
    idx: number;
    tag: string;
    when: number;
    breakpoints: boolean;
}

interface Journal {
    entries: JournalEntry[];
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
    const sql = fs.readFileSync(
        path.join(migrationsFolder, `${entry.tag}.sql`),
        "utf8",
    );
    const createTable = sql.match(
        /CREATE TABLE\s+(?:IF NOT EXISTS\s+)?"?(\w+)"?/i,
    );
    if (createTable?.[1]) {
        const rows = await dbClient`
            SELECT 1
            FROM information_schema.tables
            WHERE table_schema = 'public'
              AND table_name = ${createTable[1]}
        `;
        return rows.length > 0;
    }

    const addColumn = sql.match(
        /ALTER TABLE\s+"?(\w+)"?\s+ADD COLUMN\s+"?(\w+)"?/i,
    );
    if (addColumn?.[1] && addColumn[2]) {
        const rows = await dbClient`
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = ${addColumn[1]}
              AND column_name = ${addColumn[2]}
        `;
        return rows.length > 0;
    }

    const createIndex = sql.match(
        /CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF NOT EXISTS\s+)?"?(\w+)"?/i,
    );
    if (createIndex?.[1]) {
        const rows = await dbClient`
            SELECT 1
            FROM pg_indexes
            WHERE schemaname = 'public'
              AND indexname = ${createIndex[1]}
        `;
        return rows.length > 0;
    }

    return false;
}

async function seedEntries(
    migrationsFolder: string,
    entries: JournalEntry[],
    migrationsTable: string,
) {
    for (const entry of entries) {
        const hash = migrationHash(migrationsFolder, entry);
        await dbClient`
            INSERT INTO drizzle.${dbClient(migrationsTable)}
                (hash, created_at)
            VALUES (${hash}, ${entry.when})
            ON CONFLICT DO NOTHING
        `;
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

    const journal = JSON.parse(fs.readFileSync(journalPath, "utf8")) as Journal;
    const trackingRows = await dbClient`
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'drizzle'
          AND table_name = ${migrationsTable}
    `;

    if (trackingRows.length === 0) {
        const siteRows = await dbClient`
            SELECT 1
            FROM information_schema.tables
            WHERE table_schema = 'public'
              AND table_name = 'sites'
        `;
        if (siteRows.length === 0) return;

        await dbClient`CREATE SCHEMA IF NOT EXISTS drizzle`;
        await dbClient`
            CREATE TABLE IF NOT EXISTS ${dbClient("drizzle")}.${dbClient(migrationsTable)} (
                id serial PRIMARY KEY,
                hash text NOT NULL,
                created_at bigint
            )
        `;
        await seedEntries(migrationsFolder, journal.entries, migrationsTable);
        return;
    }

    const appliedRows = await dbClient`
        SELECT hash
        FROM drizzle.${dbClient(migrationsTable)}
        ORDER BY id
    `;
    const appliedHashes = new Set(
        appliedRows.map((row) => String(row["hash"])),
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
