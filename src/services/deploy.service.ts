import { createHash, randomBytes } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { and, desc, eq, inArray, ne } from 'drizzle-orm'
import { lookup } from 'mime-types'
import { db } from '../infrastructure/db/db.js'
import { blobTreeEntries, blobs, deployments, pages, sites } from '../infrastructure/db/schema.js'
import { usageRedis, redis } from '../infrastructure/cache/redis.js'
import {
    SHARED_BUCKET,
    blobObjectKey,
    deleteFolder,
    liveSitePrefix,
    minioClient,
} from '../infrastructure/storage/minio.js'
import {
    DEPLOY_TOKEN_TTL_SECONDS,
    DEPLOYMENT_RETENTION,
    MAX_DEPLOY_FILE_SIZE,
    MAX_FILE_SIZE,
    PRESIGN_EXPIRY_SECONDS,
} from '../constants/index.js'
import { validateFile } from '../utils/file-validator.js'
import { HttpError } from '../utils/http-error.js'
import type {
    CommitDeployInput,
    DeployFileInput,
    PrepareDeployInput,
    PresignDeployInput,
} from '../validators/deploy.validator.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface DeployTokenPayload {
    pageId: string
    userId: string
    siteId: string
    subdomain: string
    fileManifest: Array<{
        path: string
        hash: string
        size: number
    }>
}

function deployTokenKey(token: string): string {
    return `deploy:token:${token}`
}

async function resolvePage(pageIdOrName: string, tenantId: string) {
    const [page] = UUID_RE.test(pageIdOrName)
        ? await db.select().from(pages).where(eq(pages.id, pageIdOrName)).limit(1)
        : await db
            .select()
            .from(pages)
            .where(and(eq(pages.project_name, pageIdOrName), eq(pages.tenant_id, tenantId)))
            .limit(1)

    if (!page) throw new HttpError('Page not found', 404)
    if (page.tenant_id !== tenantId) throw new HttpError('Forbidden', 403)

    const [site] = await db.select().from(sites).where(eq(sites.id, page.site_id)).limit(1)
    if (!site) throw new HttpError('Site not found', 404)

    return { page, site }
}

async function loadDeployToken(token: string, tenantId: string): Promise<DeployTokenPayload> {
    const raw = await usageRedis.get(deployTokenKey(token))
    if (!raw) throw new HttpError('Deployment token expired or invalid', 400)

    let payload: DeployTokenPayload
    try {
        payload = JSON.parse(raw) as DeployTokenPayload
    } catch {
        throw new HttpError('Corrupt deployment token', 400)
    }

    if (payload.userId !== tenantId) throw new HttpError('Forbidden', 403)
    return payload
}

async function objectExists(key: string): Promise<boolean> {
    try {
        await minioClient.statObject(SHARED_BUCKET, key)
        return true
    } catch {
        return false
    }
}

async function ensureBlobRecord(hash: string, size: number): Promise<'deployed' | 'reused'> {
    const [existing] = await db.select().from(blobs).where(eq(blobs.hash, hash)).limit(1)
    if (existing) return 'reused'

    const key = blobObjectKey(hash)
    if (!(await objectExists(key))) {
        throw new HttpError(`Missing blob object for hash ${hash}`, 400)
    }

    await db.insert(blobs).values({ hash, size }).onConflictDoNothing()
    return 'deployed'
}

/**
 * Upload a blob from a local buffer if it is not already in the store.
 */
export async function storeBlobFromBuffer(
    hash: string,
    body: Buffer,
    contentType = 'application/octet-stream'
): Promise<'deployed' | 'reused'> {
    const [existing] = await db.select().from(blobs).where(eq(blobs.hash, hash)).limit(1)
    if (existing) return 'reused'

    const key = blobObjectKey(hash)
    if (!(await objectExists(key))) {
        await minioClient.putObject(SHARED_BUCKET, key, body, body.length, {
            'Content-Type': contentType,
        })
    }

    await db.insert(blobs).values({ hash, size: body.length }).onConflictDoNothing()
    return 'deployed'
}

/**
 * Materialize a deployment's blob tree into the live site prefix.
 */
export async function materializeDeploymentToLive(
    deploymentId: string,
    siteId: string
): Promise<number> {
    const entries = await db
        .select()
        .from(blobTreeEntries)
        .where(eq(blobTreeEntries.deploymentId, deploymentId))

    const livePrefix = liveSitePrefix(siteId)
    await deleteFolder(livePrefix)

    for (const entry of entries) {
        const destKey = `${livePrefix}${entry.path}`
        const srcKey = blobObjectKey(entry.blobHash)
        await minioClient.copyObject(SHARED_BUCKET, destKey, `/${SHARED_BUCKET}/${srcKey}`)
    }

    return entries.length
}

async function activateDeployment(pageId: string, deploymentId: string): Promise<void> {
    await db
        .update(deployments)
        .set({ is_active: true })
        .where(eq(deployments.id, deploymentId))

    await db
        .update(deployments)
        .set({ is_active: false })
        .where(and(eq(deployments.page_id, pageId), ne(deployments.id, deploymentId)))
}

async function pruneOldDeployments(pageId: string): Promise<void> {
    const allDeps = await db
        .select({ id: deployments.id })
        .from(deployments)
        .where(eq(deployments.page_id, pageId))
        .orderBy(desc(deployments.version))

    if (allDeps.length <= DEPLOYMENT_RETENTION) return

    const toDelete = allDeps.slice(DEPLOYMENT_RETENTION)
    for (const dep of toDelete) {
        await db.delete(deployments).where(eq(deployments.id, dep.id))
    }
}

async function nextVersion(pageId: string): Promise<number> {
    const [latest] = await db
        .select({ version: deployments.version })
        .from(deployments)
        .where(eq(deployments.page_id, pageId))
        .orderBy(desc(deployments.version))
        .limit(1)

    return latest ? latest.version + 1 : 1
}

export async function invalidateSiteCache(subdomain: string): Promise<void> {
    // Caddy reads site:{subdomain} from the default Redis DB
    await redis.del(`site:${subdomain}`)
}

export interface BlobManifestFile {
    path: string
    hash: string
    size: number
}

/**
 * Shared commit path for CLI and cloud builds:
 * blobs already in MinIO → write tree → materialize live → activate.
 */
export async function commitBlobTreeDeploy(opts: {
    pageId: string
    tenantId: string
    siteId: string
    subdomain: string
    source: 'build' | 'upload'
    buildId: string | null
    fileManifest: BlobManifestFile[]
    filesDeployed: number
    filesReused: number
}) {
    if (opts.fileManifest.length === 0) {
        throw new HttpError('Cannot deploy an empty file tree', 400)
    }

    const version = await nextVersion(opts.pageId)

    const [newDep] = await db
        .insert(deployments)
        .values({
            page_id: opts.pageId,
            site_id: opts.siteId,
            tenant_id: opts.tenantId,
            build_id: opts.buildId,
            version,
            is_active: false,
            source: opts.source,
            file_count: opts.fileManifest.length,
            filesDeployed: opts.filesDeployed,
            filesReused: opts.filesReused,
        })
        .returning()

    if (!newDep) throw new HttpError('Failed to create deployment record', 500)

    await db.insert(blobTreeEntries).values(
        opts.fileManifest.map((f) => ({
            deploymentId: newDep.id,
            path: f.path,
            blobHash: f.hash,
        }))
    )

    await materializeDeploymentToLive(newDep.id, opts.siteId)
    await activateDeployment(opts.pageId, newDep.id)
    await pruneOldDeployments(opts.pageId)
    await invalidateSiteCache(opts.subdomain)

    const [updated] = await db
        .select()
        .from(deployments)
        .where(eq(deployments.id, newDep.id))
        .limit(1)

    return updated
}

/**
 * Cloud-build deploy: hash local output → store blobs/{sha256} → commit tree → live.
 */
export async function deployFromLocalDirectory(opts: {
    outputDir: string
    files: string[]
    pageId: string
    tenantId: string
    siteId: string
    subdomain: string
    buildId: string
    log?: (message: string) => void | Promise<void>
}) {
    const { outputDir, files, log } = opts
    const fileManifest: BlobManifestFile[] = []
    const uploadedHashes = new Set<string>()
    let filesDeployed = 0
    let filesReused = 0

    for (const absolutePath of files) {
        const relativePath = path
            .relative(outputDir, absolutePath)
            .split(path.sep)
            .join('/')

        if (!relativePath || relativePath.startsWith('..')) continue

        const body = await fs.readFile(absolutePath)
        const hash = createHash('sha256').update(body).digest('hex')
        const contentType = lookup(relativePath) || 'application/octet-stream'

        if (!uploadedHashes.has(hash)) {
            const result = await storeBlobFromBuffer(hash, body, contentType)
            if (result === 'deployed') {
                filesDeployed++
                await log?.(`Stored blob ${hash.slice(0, 12)}… (${relativePath})`)
            } else {
                filesReused++
                await log?.(`Reused blob ${hash.slice(0, 12)}… (${relativePath})`)
            }
            uploadedHashes.add(hash)
        }

        fileManifest.push({ path: relativePath, hash, size: body.length })
    }

    await log?.(`Committing blob tree (${fileManifest.length} files)…`)

    const deployment = await commitBlobTreeDeploy({
        pageId: opts.pageId,
        tenantId: opts.tenantId,
        siteId: opts.siteId,
        subdomain: opts.subdomain,
        source: 'build',
        buildId: opts.buildId,
        fileManifest,
        filesDeployed,
        filesReused,
    })

    return {
        deployment,
        filesDeployed,
        filesReused,
        fileCount: fileManifest.length,
    }
}

export async function prepareDeploy(
    input: PrepareDeployInput,
    tenantId: string
) {
    const { page, site } = await resolvePage(input.pageId, tenantId)

    // Deduplicate paths
    const seenPaths = new Set<string>()
    let totalSize = 0

    for (const file of input.files) {
        if (seenPaths.has(file.path)) {
            throw new HttpError(`Duplicate path in manifest: ${file.path}`, 400)
        }
        seenPaths.add(file.path)
        totalSize += file.size

        await validateFile(file.magicBytes, file.path, file.size, MAX_DEPLOY_FILE_SIZE)
    }

    if (totalSize > MAX_FILE_SIZE) {
        throw new HttpError(
            `Total deploy size ${totalSize} exceeds limit of ${MAX_FILE_SIZE} bytes`,
            400
        )
    }

    const hashes = [...new Set(input.files.map((f) => f.hash))]
    const existing = hashes.length
        ? await db.select({ hash: blobs.hash }).from(blobs).where(inArray(blobs.hash, hashes))
        : []
    const existingSet = new Set(existing.map((b) => b.hash))

    const uploadRequired: Array<{ path: string; hash: string; size: number }> = []
    const neededHashes = new Set<string>()

    for (const file of input.files) {
        if (!existingSet.has(file.hash) && !neededHashes.has(file.hash)) {
            neededHashes.add(file.hash)
            uploadRequired.push({ path: file.path, hash: file.hash, size: file.size })
        }
    }

    const filesReused = hashes.filter((h) => existingSet.has(h)).length
    const filesToUpload = neededHashes.size

    const token = randomBytes(24).toString('hex')
    const payload: DeployTokenPayload = {
        pageId: page.id,
        userId: tenantId,
        siteId: page.site_id,
        subdomain: site.subdomain,
        fileManifest: input.files.map((f: DeployFileInput) => ({
            path: f.path,
            hash: f.hash,
            size: f.size,
        })),
    }

    await usageRedis.set(
        deployTokenKey(token),
        JSON.stringify(payload),
        'EX',
        DEPLOY_TOKEN_TTL_SECONDS
    )

    return {
        deploymentToken: token,
        expiresIn: DEPLOY_TOKEN_TTL_SECONDS,
        uploadRequired,
        filesReused,
        filesToUpload,
    }
}

export async function presignDeploy(input: PresignDeployInput, tenantId: string) {
    const payload = await loadDeployToken(input.deploymentToken, tenantId)
    const manifestHashes = new Set(payload.fileManifest.map((f) => f.hash))

    const existing = input.hashes.length
        ? await db
            .select({ hash: blobs.hash })
            .from(blobs)
            .where(inArray(blobs.hash, input.hashes))
        : []
    const existingSet = new Set(existing.map((b) => b.hash))

    const urls: Array<{ hash: string; url: string; method: 'PUT' }> = []

    for (const hash of input.hashes) {
        if (!manifestHashes.has(hash)) {
            throw new HttpError(`Hash ${hash} is not in the deployment manifest`, 400)
        }
        if (existingSet.has(hash)) {
            continue
        }

        const url = await minioClient.presignedPutObject(
            SHARED_BUCKET,
            blobObjectKey(hash),
            PRESIGN_EXPIRY_SECONDS
        )
        urls.push({ hash, url, method: 'PUT' })
    }

    return { urls }
}

export async function commitDeploy(input: CommitDeployInput, tenantId: string) {
    const payload = await loadDeployToken(input.deploymentToken, tenantId)

    const uniqueByHash = new Map<string, { hash: string; size: number }>()
    for (const file of payload.fileManifest) {
        uniqueByHash.set(file.hash, { hash: file.hash, size: file.size })
    }

    let filesDeployed = 0
    let filesReused = 0

    for (const blob of uniqueByHash.values()) {
        const result = await ensureBlobRecord(blob.hash, blob.size)
        if (result === 'deployed') filesDeployed++
        else filesReused++
    }

    const deployment = await commitBlobTreeDeploy({
        pageId: payload.pageId,
        tenantId,
        siteId: payload.siteId,
        subdomain: payload.subdomain,
        source: 'upload',
        buildId: null,
        fileManifest: payload.fileManifest,
        filesDeployed,
        filesReused,
    })

    await usageRedis.del(deployTokenKey(input.deploymentToken))

    return {
        success: true,
        deployment,
        filesDeployed,
        filesReused,
    }
}
