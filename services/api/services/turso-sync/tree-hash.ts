import { createHash } from 'node:crypto'

export interface TreeEntry {
    path: string
    blobHash: string
}

/**
 * Deterministic checksum of a blob tree.
 *
 * Sorts `path:blob_hash` lines (byte order), concatenates them with '\n', and
 * hashes with SHA-256. Sorting makes the hash independent of row order, so two
 * semantically identical trees always produce the same hash. Used to detect an
 * incomplete or mismatched tree during reconciliation.
 */
export function treeHash(entries: TreeEntry[]): string {
    const lines = entries
        .map((e) => `${e.path}:${e.blobHash}`)
        .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))

    const hash = createHash('sha256')
    for (const line of lines) {
        hash.update(line)
        hash.update('\n')
    }
    return hash.digest('hex')
}