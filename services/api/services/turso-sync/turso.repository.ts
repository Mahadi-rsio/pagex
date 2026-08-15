import { createClient, type Client, type InStatement } from '@libsql/client'
import type { TreeEntry } from './tree-hash.js'

/**
 * Mirrors the blob-server's read-model schema (services/blob-server/src/turso.go)
 * so the Go resolver can serve what this writer produces:
 *
 *   site_deployments(site_id, deployment_id, version, seq)  — active pointer
 *   blob_tree_entries(deployment_id, path, blob_hash)        — per-deployment tree
 *
 * `deployment_metadata` is additive (API-side only): it stores a deterministic
 * tree checksum so reconciliation can detect an incomplete/mismatched tree
 * without reading every entry back.
 *
 * A deployment tree is written in ONE atomic libSQL write transaction: entries
 * are never observable before the active pointer is set, and a failed write
 * rolls back so the previous active deployment stays valid.
 */
export const TURSO_DDL = `
CREATE TABLE IF NOT EXISTS site_deployments (
    site_id       TEXT PRIMARY KEY,
    deployment_id TEXT NOT NULL,
    version       INTEGER NOT NULL,
    seq           INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS blob_tree_entries (
    deployment_id TEXT NOT NULL,
    path          TEXT NOT NULL,
    blob_hash     TEXT NOT NULL,
    PRIMARY KEY (deployment_id, path)
);

CREATE INDEX IF NOT EXISTS idx_blob_tree_deployment
    ON blob_tree_entries(deployment_id);

CREATE TABLE IF NOT EXISTS deployment_metadata (
    deployment_id TEXT PRIMARY KEY,
    tree_hash     TEXT NOT NULL,
    entry_count   INTEGER NOT NULL
);
`

export interface TursoPointer {
    deploymentId: string
    version: number
    seq: number
}

export interface TursoTreeMetadata {
    treeHash: string
    entryCount: number
}

export interface TursoDeploymentWrite {
    siteId: string
    deploymentId: string
    version: number
    entries: TreeEntry[]
    treeHashValue: string
    /** Set the site's active pointer only when PostgreSQL still marks this deployment active. */
    active: boolean
}

export interface TursoRepository {
    ensureSchema(): Promise<void>
    writeDeploymentTree(write: TursoDeploymentWrite): Promise<void>
    getPointer(siteId: string): Promise<TursoPointer | null>
    getTreeMetadata(deploymentId: string): Promise<TursoTreeMetadata | null>
    close(): Promise<void>
}

export class LibsqlTursoRepository implements TursoRepository {
    private readonly client: Client

    constructor(opts: { url: string; authToken?: string }) {
        this.client = createClient({
            url: opts.url,
            ...(opts.authToken ? { authToken: opts.authToken } : {}),
        })
    }

    async ensureSchema(): Promise<void> {
        await this.client.batch(TURSO_DDL.split(';').filter((s) => s.trim()), 'write')
    }

    async writeDeploymentTree(write: TursoDeploymentWrite): Promise<void> {
        const stmts: InStatement[] = []

        for (const entry of write.entries) {
            stmts.push({
                sql:
                    'INSERT INTO blob_tree_entries (deployment_id, path, blob_hash) VALUES (?, ?, ?) ' +
                    'ON CONFLICT (deployment_id, path) DO UPDATE SET blob_hash = excluded.blob_hash',
                args: [write.deploymentId, entry.path, entry.blobHash],
            })
        }

        stmts.push({
            sql:
                'INSERT INTO deployment_metadata (deployment_id, tree_hash, entry_count) VALUES (?, ?, ?) ' +
                'ON CONFLICT (deployment_id) DO UPDATE SET tree_hash = excluded.tree_hash, entry_count = excluded.entry_count',
            args: [write.deploymentId, write.treeHashValue, write.entries.length],
        })

        // Pointer last: the active deployment is only published once its complete
        // tree is guaranteed present in the same transaction.
        if (write.active) {
            stmts.push({
                sql:
                    'INSERT INTO site_deployments (site_id, deployment_id, version, seq) VALUES (?, ?, ?, ?) ' +
                    'ON CONFLICT (site_id) DO UPDATE SET ' +
                    'deployment_id = excluded.deployment_id, version = excluded.version, seq = excluded.seq',
                args: [write.siteId, write.deploymentId, write.version, write.version],
            })
        }

        await this.client.batch(stmts, 'write')
    }

    async getPointer(siteId: string): Promise<TursoPointer | null> {
        const res = await this.client.execute({
            sql: 'SELECT deployment_id, version, seq FROM site_deployments WHERE site_id = ?',
            args: [siteId],
        })
        const row = res.rows[0]
        if (!row) return null
        return {
            deploymentId: String(row['deployment_id']),
            version: Number(row['version']),
            seq: Number(row['seq']),
        }
    }

    async getTreeMetadata(deploymentId: string): Promise<TursoTreeMetadata | null> {
        const res = await this.client.execute({
            sql: 'SELECT tree_hash, entry_count FROM deployment_metadata WHERE deployment_id = ?',
            args: [deploymentId],
        })
        const row = res.rows[0]
        if (!row) return null
        return {
            treeHash: String(row['tree_hash']),
            entryCount: Number(row['entry_count']),
        }
    }

    async close(): Promise<void> {
        await this.client.close()
    }
}