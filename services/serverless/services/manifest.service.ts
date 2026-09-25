import { createHash } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { redis } from '../infrastructure/cache/redis.js'
import { db } from '../infrastructure/db/db.js'
import { blobTreeEntries, deployments } from '../infrastructure/db/schema.js'
import {
    getManifestObject,
    manifestObjectKey,
    putManifestIfAbsent,
} from '../infrastructure/storage/minio.js'
import { HttpError } from '../utils/http-error.js'
import {
    DEPLOYMENT_MANIFEST_VERSION,
    MANIFEST_REDIS_TTL_SECONDS,
} from '../constants/index.js'
import {
    normalizeBlobHashForStorage,
    normalizeManifestPath,
    serializeManifest,
    validateDeploymentManifest,
    type DeploymentManifest,
} from '../utils/manifest-validation.js'

export type { DeploymentManifest }
export {
    normalizeManifestPath,
    serializeManifest,
    validateDeploymentManifest,
} from '../utils/manifest-validation.js'

export function manifestContentHash(body: Buffer): string {
    return createHash('sha256').update(body).digest('hex')
}

/** Build manifest from blob_tree_entries (control-plane source of truth). */
export async function buildManifestFromBlobTree(
    deploymentId: string
): Promise<DeploymentManifest> {
    const entries = await db
        .select({
            path: blobTreeEntries.path,
            blobHash: blobTreeEntries.blobHash,
        })
        .from(blobTreeEntries)
        .where(eq(blobTreeEntries.deploymentId, deploymentId))

    const files: Record<string, string> = {}
    for (const entry of entries) {
        const path = normalizeManifestPath(entry.path)
        if (path === null) {
            throw new HttpError(`Invalid blob tree path: ${entry.path}`, 400)
        }
        if (files[path]) {
            throw new HttpError(`Duplicate blob tree path: ${path}`, 400)
        }
        const hash = normalizeBlobHashForStorage(entry.blobHash)
        if (!hash) {
            throw new HttpError(`Invalid blob hash for path ${path}`, 400)
        }
        files[path] = hash
    }

    const manifest: DeploymentManifest = {
        version: DEPLOYMENT_MANIFEST_VERSION,
        deploymentId,
        files,
    }

    const check = validateDeploymentManifest(manifest, deploymentId)
    if (!check.valid) {
        throw new HttpError(`Manifest validation failed: ${check.error}`, 400)
    }

    return check.manifest
}

export function activeDeploymentRedisKey(siteId: string): string {
    return `active_deployment:${siteId}`
}

export function manifestRedisKey(deploymentId: string): string {
    return `manifest:${deploymentId}`
}

export async function cacheManifestInRedis(
    deploymentId: string,
    manifest: DeploymentManifest
): Promise<void> {
    await redis.set(
        manifestRedisKey(deploymentId),
        JSON.stringify(manifest),
        'EX',
        MANIFEST_REDIS_TTL_SECONDS
    )
}

export async function setActiveDeploymentCache(
    siteId: string,
    deploymentId: string
): Promise<void> {
    await redis.set(activeDeploymentRedisKey(siteId), deploymentId)
}

export async function incrementSiteVersion(siteId: string): Promise<void> {
    await redis.incr(`site_version:${siteId}`)
}

export async function clearDeploymentRuntimeCache(siteId: string, deploymentId?: string): Promise<void> {
    const pipeline = redis.pipeline()
    pipeline.del(activeDeploymentRedisKey(siteId))
    if (deploymentId) {
        pipeline.del(manifestRedisKey(deploymentId))
    }
    await pipeline.exec()
}

/**
 * Generate, validate, persist manifest to MinIO, and record metadata on deployment.
 * Idempotent: if manifest_key is already set, returns existing metadata.
 */
export async function generateAndPersistManifest(deploymentId: string): Promise<{
    manifest: DeploymentManifest
    manifestKey: string
    manifestHash: string
    manifestSize: number
    created: boolean
}> {
    const [dep] = await db
        .select()
        .from(deployments)
        .where(eq(deployments.id, deploymentId))
        .limit(1)

    if (!dep) {
        throw new HttpError('Deployment not found', 404)
    }

    if (dep.manifestKey && dep.manifestHash && dep.manifestVersion && dep.manifestSize) {
        const body = await getManifestObject(deploymentId)
        const parsed = JSON.parse(body.toString('utf8')) as unknown
        const check = validateDeploymentManifest(parsed, deploymentId)
        if (!check.valid) {
            throw new HttpError(`Stored manifest invalid: ${check.error}`, 500)
        }
        return {
            manifest: check.manifest,
            manifestKey: dep.manifestKey,
            manifestHash: dep.manifestHash,
            manifestSize: dep.manifestSize,
            created: false,
        }
    }

    const manifest = await buildManifestFromBlobTree(deploymentId)
    const body = serializeManifest(manifest)
    const hash = manifestContentHash(body)
    const key = manifestObjectKey(deploymentId)

    const putResult = await putManifestIfAbsent(deploymentId, body, hash)
    if (putResult === 'exists') {
        const existingBody = await getManifestObject(deploymentId)
        const existingHash = manifestContentHash(existingBody)
        if (existingHash !== hash) {
            throw new HttpError(
                'Manifest object already exists with different content (immutable violation)',
                409
            )
        }
    }

    await db
        .update(deployments)
        .set({
            manifestKey: key,
            manifestVersion: DEPLOYMENT_MANIFEST_VERSION,
            manifestSize: body.length,
            manifestHash: hash,
        })
        .where(eq(deployments.id, deploymentId))

    return {
        manifest,
        manifestKey: key,
        manifestHash: hash,
        manifestSize: body.length,
        created: putResult === 'created',
    }
}

export async function regenerateManifest(deploymentId: string): Promise<DeploymentManifest> {
    const result = await generateAndPersistManifest(deploymentId)
    await cacheManifestInRedis(deploymentId, result.manifest)
    return result.manifest
}
