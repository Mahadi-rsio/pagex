import {
    DEPLOYMENT_MANIFEST_VERSION,
    MAX_MANIFEST_SIZE_BYTES,
} from '../constants/index.js'
import { HttpError } from '../utils/http-error.js'

/** Runtime deployment manifest (JSON on wire; MessagePack-ready shape). */
export interface DeploymentManifest {
    version: number
    deploymentId: string
    files: Record<string, string>
}

const SHA256_HEX_RE = /^[a-f0-9]{64}$/i
const SHA256_PREFIX_RE = /^sha256:[a-f0-9]{64}$/i

/** Normalize manifest lookup paths (no leading slash, no traversal). */
export function normalizeManifestPath(raw: string): string | null {
    if (!raw || raw.includes('\0')) return null

    let p = raw.trim()
    if (p.startsWith('/')) p = p.slice(1)

    const lower = p.toLowerCase()
    if (
        lower.includes('..') ||
        lower.includes('%2e') ||
        lower.includes('%2f') ||
        lower.includes('\\')
    ) {
        return null
    }

    p = p.replace(/\/+/g, '/')
    if (p.startsWith('/')) p = p.slice(1)
    if (p.includes('..')) return null

    return p
}

function normalizeBlobHash(hash: string): string | null {
    if (SHA256_HEX_RE.test(hash)) return hash.toLowerCase()
    const m = hash.match(/^sha256:([a-f0-9]{64})$/i)
    if (m) return m[1]!.toLowerCase()
    return null
}

export function validateDeploymentManifest(
    manifest: unknown,
    expectedDeploymentId?: string
): { valid: true; manifest: DeploymentManifest } | { valid: false; error: string } {
    if (!manifest || typeof manifest !== 'object') {
        return { valid: false, error: 'Manifest must be an object' }
    }

    const m = manifest as Record<string, unknown>

    if (m.version !== DEPLOYMENT_MANIFEST_VERSION) {
        return { valid: false, error: `Unsupported manifest version: ${String(m.version)}` }
    }

    if (typeof m.deploymentId !== 'string' || !m.deploymentId) {
        return { valid: false, error: 'Missing deploymentId' }
    }

    if (expectedDeploymentId && m.deploymentId !== expectedDeploymentId) {
        return { valid: false, error: 'deploymentId mismatch' }
    }

    if (!m.files || typeof m.files !== 'object' || Array.isArray(m.files)) {
        return { valid: false, error: 'files must be an object' }
    }

    const files: Record<string, string> = {}
    const seenPaths = new Set<string>()

    for (const [rawPath, rawHash] of Object.entries(m.files as Record<string, unknown>)) {
        const path = normalizeManifestPath(rawPath)
        if (path === null) {
            return { valid: false, error: `Invalid path: ${rawPath}` }
        }
        if (seenPaths.has(path)) {
            return { valid: false, error: `Duplicate path: ${path}` }
        }
        seenPaths.add(path)

        if (typeof rawHash !== 'string' || !rawHash) {
            return { valid: false, error: `Invalid hash for path ${path}` }
        }

        const hash = normalizeBlobHash(rawHash)
        if (!hash) {
            return { valid: false, error: `Invalid blob hash for path ${path}` }
        }

        files[path] = hash
    }

    return {
        valid: true,
        manifest: {
            version: DEPLOYMENT_MANIFEST_VERSION,
            deploymentId: m.deploymentId,
            files,
        },
    }
}

export function serializeManifest(manifest: DeploymentManifest): Buffer {
    const json = JSON.stringify(manifest)
    const buf = Buffer.from(json, 'utf8')
    if (buf.length > MAX_MANIFEST_SIZE_BYTES) {
        throw new HttpError(
            `Manifest exceeds maximum size (${MAX_MANIFEST_SIZE_BYTES} bytes)`,
            400
        )
    }
    return buf
}

export function normalizeBlobHashForStorage(hash: string): string | null {
    return normalizeBlobHash(hash)
}
