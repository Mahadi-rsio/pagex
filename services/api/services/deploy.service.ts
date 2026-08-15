import { createHash, randomBytes } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import { brotliCompress, gzip } from 'node:zlib'
import { and, desc, eq, inArray, ne } from 'drizzle-orm'
import { lookup } from 'mime-types'
import pLimit from 'p-limit'
import sharp from 'sharp'
import { db } from '../infrastructure/db/db.js'
import { blobTreeEntries, blobs, deployments, pages, sites } from '../infrastructure/db/schema.js'
import { usageRedis, redis } from '../infrastructure/cache/redis.js'
import {
    SHARED_BUCKET,
    blobObjectKey,
    minioClient,
    objectMetaForPath,
} from '../infrastructure/storage/minio.js'
import {
    BLOB_IO_CONCURRENCY,
    DEPLOY_TOKEN_TTL_SECONDS,
    MAX_DEPLOY_FILE_SIZE,
    MAX_FILE_SIZE,
    PRESIGN_EXPIRY_SECONDS,
    SITE_FILES_TTL_SECONDS,
} from '../constants/index.js'
import { runDeploymentGC } from './gc.service.js'
import { enqueueDeploymentSync } from './turso-sync/sync.repository.js'
import { validateManifest } from '../utils/deployment-validator.js'
import { validateFile } from '../utils/file-validator.js'
import { HttpError } from '../utils/http-error.js'
import type {
    CommitDeployInput,
    DeployFileInput,
    PrepareDeployInput,
    PresignDeployInput,
} from '../validators/deploy.validator.js'

const brotliCompressAsync = promisify(brotliCompress)
const gzipAsync = promisify(gzip)

/** Text-like assets eligible for Brotli + Gzip variants at commit time. */
const COMPRESSIBLE_EXTS = new Set(['.html', '.css', '.js', '.json', '.svg', '.xml'])

/** Already-compressed formats — never re-compress. */
const SKIP_COMPRESS_EXTS = new Set([
    '.br', '.gz', '.webp', '.woff', '.woff2', '.mp4', '.zip',
])

/** Raster images converted to WebP (original kept). */
const WEBP_SOURCE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif'])

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

/**
 * Upload a blob from a local buffer if it is not already in the store.
 */
export async function storeBlobFromBuffer(
    hash: string,
    body: Buffer,
    contentType = 'application/octet-stream',
    contentEncoding?: string
): Promise<'deployed' | 'reused'> {
    const [existing] = await db.select().from(blobs).where(eq(blobs.hash, hash)).limit(1)
    if (existing) return 'reused'

    const key = blobObjectKey(hash)
    if (!(await objectExists(key))) {
        await minioClient.putObject(
            SHARED_BUCKET,
            key,
            body,
            body.length,
            objectMetaForPath(key, contentType, contentEncoding)
        )
    }

    await db.insert(blobs).values({ hash, size: body.length }).onConflictDoNothing()
    return 'deployed'
}

async function readBlobBuffer(hash: string): Promise<Buffer> {
    try {
        const stream = await minioClient.getObject(SHARED_BUCKET, blobObjectKey(hash))
        const chunks: Buffer[] = []
        for await (const chunk of stream) {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
        }
        return Buffer.concat(chunks)
    } catch {
        throw new HttpError(`Missing blob object for hash ${hash}`, 400)
    }
}

interface FileVariant {
    path: string
    hash: string
    size: number
    body: Buffer
    contentType: string
    contentEncoding?: string
}

/** Per-source savings collected while expanding variants. */
interface VariantExpandStats {
    /** Original source size in bytes */
    originalSize: number
    /** Best of .br/.gz size when compression succeeded; otherwise null */
    bestCompressedSize: number | null
    /** Original image size when WebP was produced; otherwise null */
    imageOriginalSize: number | null
    /** WebP size when conversion succeeded; otherwise null */
    imageWebpSize: number | null
    compressedVariants: number
    webpVariants: number
}

export interface DeployOptimizationSummary {
    totalFiles: number
    totalSize: number
    totalSizeHuman: string
    /** Source files that received at least one .br/.gz variant */
    filesCompressed: number
    /** Bytes saved vs best text compression (original − min(br, gz)) */
    sizeReduced: number
    sizeReducedHuman: string
    sizeReducedPercent: number
    /** Images successfully converted to WebP */
    imagesOptimized: number
    imageOriginalSize: number
    imageOptimizedSize: number
    /** Bytes saved by WebP vs original images */
    imageSizeReduced: number
    imageSizeReducedHuman: string
    imageSizeReducedPercent: number
    /** Total tree entries after variants (originals + .br/.gz/.webp) */
    deployedFiles: number
    compressedVariants: number
    webpVariants: number
}

function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

function percentSaved(original: number, saved: number): number {
    if (original <= 0 || saved <= 0) return 0
    return Math.round((saved / original) * 10000) / 100
}

function buildOptimizationSummary(
    sources: Array<{ path: string; body: Buffer }>,
    fileManifestLength: number,
    stats: VariantExpandStats[]
): DeployOptimizationSummary {
    const totalSize = sources.reduce((sum, s) => sum + s.body.length, 0)

    let sizeReduced = 0
    let compressibleOriginal = 0
    let filesCompressed = 0
    let imagesOptimized = 0
    let imageOriginalSize = 0
    let imageOptimizedSize = 0
    let compressedVariants = 0
    let webpVariants = 0

    for (const s of stats) {
        compressedVariants += s.compressedVariants
        webpVariants += s.webpVariants

        if (s.bestCompressedSize !== null) {
            filesCompressed++
            compressibleOriginal += s.originalSize
            sizeReduced += Math.max(0, s.originalSize - s.bestCompressedSize)
        }
        if (s.imageOriginalSize !== null && s.imageWebpSize !== null) {
            imagesOptimized++
            imageOriginalSize += s.imageOriginalSize
            imageOptimizedSize += s.imageWebpSize
        }
    }

    const imageSizeReduced = Math.max(0, imageOriginalSize - imageOptimizedSize)

    return {
        totalFiles: sources.length,
        totalSize,
        totalSizeHuman: formatBytes(totalSize),
        filesCompressed,
        sizeReduced,
        sizeReducedHuman: formatBytes(sizeReduced),
        sizeReducedPercent: percentSaved(compressibleOriginal, sizeReduced),
        imagesOptimized,
        imageOriginalSize,
        imageOptimizedSize,
        imageSizeReduced,
        imageSizeReducedHuman: formatBytes(imageSizeReduced),
        imageSizeReducedPercent: percentSaved(imageOriginalSize, imageSizeReduced),
        deployedFiles: fileManifestLength,
        compressedVariants,
        webpVariants,
    }
}

type DeployLogFn = (message: string) => void | Promise<void>

/**
 * Expand one source file into original + optional Brotli/Gzip/WebP variants.
 * Compression/conversion failures are logged and skipped — never thrown.
 */
async function expandFileVariants(
    relativePath: string,
    body: Buffer,
    log?: DeployLogFn
): Promise<{ variants: FileVariant[]; stats: VariantExpandStats }> {
    const ext = path.extname(relativePath).toLowerCase()
    const contentType = lookup(relativePath) || 'application/octet-stream'
    const hash = createHash('sha256').update(body).digest('hex')

    const variants: FileVariant[] = [
        {
            path: relativePath,
            hash,
            size: body.length,
            body,
            contentType,
        },
    ]

    const stats: VariantExpandStats = {
        originalSize: body.length,
        bestCompressedSize: null,
        imageOriginalSize: null,
        imageWebpSize: null,
        compressedVariants: 0,
        webpVariants: 0,
    }

    const shouldCompress =
        COMPRESSIBLE_EXTS.has(ext) && !SKIP_COMPRESS_EXTS.has(ext)

    if (shouldCompress) {
        const compressedSizes: number[] = []

        try {
            const brBody = await brotliCompressAsync(body)
            variants.push({
                path: `${relativePath}.br`,
                hash: createHash('sha256').update(brBody).digest('hex'),
                size: brBody.length,
                body: brBody,
                contentType,
                contentEncoding: 'br',
            })
            compressedSizes.push(brBody.length)
            stats.compressedVariants++
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err)
            console.warn(`Brotli failed for ${relativePath}:`, message)
            await log?.(`Skipped .br for ${relativePath}: ${message}`)
        }

        try {
            const gzBody = await gzipAsync(body)
            variants.push({
                path: `${relativePath}.gz`,
                hash: createHash('sha256').update(gzBody).digest('hex'),
                size: gzBody.length,
                body: gzBody,
                contentType,
                contentEncoding: 'gzip',
            })
            compressedSizes.push(gzBody.length)
            stats.compressedVariants++
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err)
            console.warn(`Gzip failed for ${relativePath}:`, message)
            await log?.(`Skipped .gz for ${relativePath}: ${message}`)
        }

        if (compressedSizes.length > 0) {
            stats.bestCompressedSize = Math.min(...compressedSizes)
        }
    }

    if (WEBP_SOURCE_EXTS.has(ext)) {
        try {
            const webpBody = await sharp(body).webp().toBuffer()
            variants.push({
                path: `${relativePath}.webp`,
                hash: createHash('sha256').update(webpBody).digest('hex'),
                size: webpBody.length,
                body: webpBody,
                contentType: 'image/webp',
            })
            stats.imageOriginalSize = body.length
            stats.imageWebpSize = webpBody.length
            stats.webpVariants++
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err)
            console.warn(`WebP conversion failed for ${relativePath}:`, message)
            await log?.(`Skipped .webp for ${relativePath}: ${message}`)
        }
    }

    return { variants, stats }
}

/**
 * Store every variant blob and build the expanded tree manifest.
 * `filesDeployed` / `filesReused` count each unique variant hash separately.
 */
async function storeExpandedVariants(
    sources: Array<{ path: string; body: Buffer }>,
    log?: DeployLogFn
): Promise<{
    fileManifest: BlobManifestFile[]
    filesDeployed: number
    filesReused: number
    summary: DeployOptimizationSummary
}> {
    const limit = pLimit(BLOB_IO_CONCURRENCY)
    const fileManifest: BlobManifestFile[] = []
    const seenHashes = new Set<string>()
    const claimedPaths = new Set(sources.map((s) => s.path))
    const allStats: VariantExpandStats[] = []
    let filesDeployed = 0
    let filesReused = 0

    // Expand variants in parallel (CPU-bound compression / WebP)
    const expanded = await Promise.all(
        sources.map((source) =>
            limit(async () => {
                const result = await expandFileVariants(source.path, source.body, log)
                return { sourcePath: source.path, ...result }
            })
        )
    )

    // Claim paths + build manifest sequentially (deterministic overwrite rules)
    const toStore: FileVariant[] = []

    for (const { sourcePath, variants, stats } of expanded) {
        allStats.push(stats)

        for (const variant of variants) {
            // Don't overwrite a path the client already uploaded (e.g. pre-made .br)
            if (variant.path !== sourcePath && claimedPaths.has(variant.path)) {
                await log?.(
                    `Skipped ${variant.path}: path already present in deploy manifest`
                )
                continue
            }
            claimedPaths.add(variant.path)

            fileManifest.push({
                path: variant.path,
                hash: variant.hash,
                size: variant.size,
            })

            if (seenHashes.has(variant.hash)) continue
            seenHashes.add(variant.hash)
            toStore.push(variant)
        }
    }

    // Upload unique blobs in parallel
    const storeResults = await Promise.all(
        toStore.map((variant) =>
            limit(async () => {
                const result = await storeBlobFromBuffer(
                    variant.hash,
                    variant.body,
                    variant.contentType,
                    variant.contentEncoding
                )
                if (result === 'deployed') {
                    await log?.(
                        `Stored blob ${variant.hash.slice(0, 12)}… (${variant.path})`
                    )
                } else {
                    await log?.(
                        `Reused blob ${variant.hash.slice(0, 12)}… (${variant.path})`
                    )
                }
                return result
            })
        )
    )

    for (const result of storeResults) {
        if (result === 'deployed') filesDeployed++
        else filesReused++
    }

    const summary = buildOptimizationSummary(sources, fileManifest.length, allStats)

    await log?.(
        `Summary: ${summary.totalFiles} files, ${summary.totalSizeHuman} total — ` +
        `text saved ${summary.sizeReducedHuman} (${summary.sizeReducedPercent}%), ` +
        `${summary.imagesOptimized} images optimized (−${summary.imageSizeReducedHuman})`
    )

    return { fileManifest, filesDeployed, filesReused, summary }
}

function siteFilesKey(siteId: string): string {
    return `site_files:${siteId}`
}

/**
 * Atomically rebuild the Redis path→blob map for a site.
 * Pipeline: DEL → HSET → EXPIRE (same Redis DB as site:{subdomain}).
 */
export async function rebuildSiteFilesMap(
    siteId: string,
    deploymentId: string
): Promise<void> {
    const entries = await db
        .select({
            path: blobTreeEntries.path,
            blobHash: blobTreeEntries.blobHash,
        })
        .from(blobTreeEntries)
        .where(eq(blobTreeEntries.deploymentId, deploymentId))

    const key = siteFilesKey(siteId)
    const pipeline = redis.pipeline()
    pipeline.del(key)

    if (entries.length > 0) {
        const fields: Record<string, string> = {}
        for (const entry of entries) {
            fields[entry.path] = entry.blobHash
        }
        pipeline.hset(key, fields)
    }

    pipeline.expire(key, SITE_FILES_TTL_SECONDS)
    await pipeline.exec()
}

/** Remove the path→blob map when a page is deleted. */
export async function clearSiteFilesMap(siteId: string): Promise<void> {
    await redis.del(siteFilesKey(siteId))
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
 * blobs already in MinIO → write tree → Redis map → activate.
 * No tenant/ copy — Caddy serves directly from blobs/{hash}.
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

    // Single transaction: deployment row + blob tree + active-flag flip + Turso
    // sync event. A crash anywhere before COMMIT leaves PostgreSQL (and thus
    // Turso's source of truth) untouched — never a half-deployed site.
    const deployment = await db.transaction(async (tx) => {
        const [newDep] = await tx
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

        await tx.insert(blobTreeEntries).values(
            opts.fileManifest.map((f) => ({
                deploymentId: newDep.id,
                path: f.path,
                blobHash: f.hash,
            }))
        )

        // Activate within the same transaction so a reader can never observe a
        // tree whose deployment is not yet live (and vice versa).
        await tx
            .update(deployments)
            .set({ is_active: true })
            .where(eq(deployments.id, newDep.id))

        await tx
            .update(deployments)
            .set({ is_active: false })
            .where(and(eq(deployments.page_id, opts.pageId), ne(deployments.id, newDep.id)))

        // Outbox event committed atomically with the activation above.
        await enqueueDeploymentSync(tx, {
            siteId: opts.siteId,
            deploymentId: newDep.id,
            version,
        })

        return newDep
    })

    await rebuildSiteFilesMap(opts.siteId, deployment.id)
    await invalidateSiteCache(opts.subdomain)

    const [updated] = await db
        .select()
        .from(deployments)
        .where(eq(deployments.id, deployment.id))
        .limit(1)

    // fire and forget — never await
    runDeploymentGC(opts.pageId, opts.siteId).catch((err) =>
        console.error('GC failed silently', err)
    )

    return updated
}

/**
 * Cloud-build deploy: hash local output → store blobs/{sha256} (+ variants) → commit tree → live.
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
    const sources: Array<{ path: string; body: Buffer }> = []

    for (const absolutePath of files) {
        const relativePath = path
            .relative(outputDir, absolutePath)
            .split(path.sep)
            .join('/')

        if (!relativePath || relativePath.startsWith('..')) continue

        const body = await fs.readFile(absolutePath)
        sources.push({ path: relativePath, body })
    }

    const { fileManifest, filesDeployed, filesReused, summary } = await storeExpandedVariants(
        sources,
        log
    )

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
        summary,
    }
}

export async function prepareDeploy(
    input: PrepareDeployInput,
    tenantId: string
) {
    const { page, site } = await resolvePage(input.pageId, tenantId)

    const manifestCheck = validateManifest(
        input.files.map((f) => ({ path: f.path, size: f.size }))
    )
    if (!manifestCheck.valid) {
        throw new HttpError(manifestCheck.error, 400)
    }

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
        summary: {
            totalFiles: input.files.length,
            totalSize,
            totalSizeHuman: formatBytes(totalSize),
            uploadSize: uploadRequired.reduce((sum, f) => sum + f.size, 0),
            uploadSizeHuman: formatBytes(
                uploadRequired.reduce((sum, f) => sum + f.size, 0)
            ),
            reusedSize: input.files
                .filter((f) => existingSet.has(f.hash))
                .reduce((sum, f) => sum + f.size, 0),
        },
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

    // Load original blob bodies in parallel, then expand with Brotli/Gzip/WebP variants
    const limit = pLimit(BLOB_IO_CONCURRENCY)
    const sources = await Promise.all(
        payload.fileManifest.map((file) =>
            limit(async () => {
                const body = await readBlobBuffer(file.hash)
                return { path: file.path, body }
            })
        )
    )

    const { fileManifest, filesDeployed, filesReused, summary } = await storeExpandedVariants(
        sources
    )

    const deployment = await commitBlobTreeDeploy({
        pageId: payload.pageId,
        tenantId,
        siteId: payload.siteId,
        subdomain: payload.subdomain,
        source: 'upload',
        buildId: null,
        fileManifest,
        filesDeployed,
        filesReused,
    })

    await usageRedis.del(deployTokenKey(input.deploymentToken))

    return {
        success: true,
        deployment,
        filesDeployed,
        filesReused,
        summary,
    }
}
