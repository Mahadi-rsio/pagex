import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { redis, redisKey } from "@/server/api/infrastructure/cache/redis";
import {
    activeDeploymentMappingKey,
    routingWriter,
} from "@/server/api/infrastructure/cache/routing";
import { db } from "@/server/api/infrastructure/db/db";
import {
    blobTreeEntries,
    deployments,
} from "@/server/api/infrastructure/db/schema";
import {
    getManifestObject,
    manifestObjectKey,
    putManifestIfAbsent,
} from "@/server/api/infrastructure/storage/minio";
import { HttpError } from "@/server/api/utils/http-error";
import {
    DEPLOYMENT_MANIFEST_VERSION,
    MANIFEST_REDIS_TTL_SECONDS,
} from "@/server/api/constants/index";
import {
    normalizeBlobHashForStorage,
    normalizeManifestPath,
    serializeManifest,
    validateDeploymentManifest,
    type DeploymentManifest,
} from "@/server/api/utils/manifest-validation";

export type { DeploymentManifest };
export {
    normalizeManifestPath,
    serializeManifest,
    validateDeploymentManifest,
} from "@/server/api/utils/manifest-validation";

export function manifestContentHash(body: Buffer): string {
    return createHash("sha256").update(body).digest("hex");
}

/** Build manifest from blob_tree_entries (control-plane source of truth). */
export async function buildManifestFromBlobTree(
    deploymentId: string,
): Promise<DeploymentManifest> {
    const entries = await db
        .select({
            path: blobTreeEntries.path,
            blobHash: blobTreeEntries.blobHash,
        })
        .from(blobTreeEntries)
        .where(eq(blobTreeEntries.deploymentId, deploymentId));

    const files: Record<string, string> = {};
    for (const entry of entries) {
        const path = normalizeManifestPath(entry.path);
        if (path === null) {
            throw new HttpError(`Invalid blob tree path: ${entry.path}`, 400);
        }
        if (files[path]) {
            throw new HttpError(`Duplicate blob tree path: ${path}`, 400);
        }
        const hash = normalizeBlobHashForStorage(entry.blobHash);
        if (!hash) {
            throw new HttpError(`Invalid blob hash for path ${path}`, 400);
        }
        files[path] = hash;
    }

    const manifest: DeploymentManifest = {
        version: DEPLOYMENT_MANIFEST_VERSION,
        deploymentId,
        files,
    };

    const check = validateDeploymentManifest(manifest, deploymentId);
    if (!check.valid) {
        throw new HttpError(`Manifest validation failed: ${check.error}`, 400);
    }

    return check.manifest;
}

export function manifestRedisKey(deploymentId: string): string {
    return `manifest:${deploymentId}`;
}

/**
 * Cache a manifest in Redis. Best-effort: the manifest object in MinIO and the
 * deployment row in PostgreSQL are authoritative, and a Redis outage must not
 * fail an already-committed deploy/rollback.
 */
export async function cacheManifestInRedis(
    deploymentId: string,
    manifest: DeploymentManifest,
): Promise<void> {
    try {
        await redis.set(
            redisKey(manifestRedisKey(deploymentId)),
            JSON.stringify(manifest),
            { ex: MANIFEST_REDIS_TTL_SECONDS },
        );
    } catch (err) {
        console.error(
            `[routing] manifest cache write failed for ${deploymentId}; MinIO/Postgres remain authoritative`,
            err,
        );
    }
}

export async function setActiveDeploymentCache(
    siteId: string,
    deploymentId: string,
): Promise<void> {
    // Writes `site:<site_id>:active` with the 1h safety TTL and swallows Redis
    // failures, so a Redis outage after a successful DB commit cannot surface
    // as a failed deploy.
    await routingWriter.setActiveDeploymentMapping(siteId, deploymentId);
}

/** Best-effort cache-busting counter; never fails a committed deploy. */
export async function incrementSiteVersion(siteId: string): Promise<void> {
    try {
        await redis.incr(redisKey(`site_version:${siteId}`));
    } catch (err) {
        console.error(
            `[routing] site_version bump failed for ${siteId}; PostgreSQL remains authoritative`,
            err,
        );
    }
}

/**
 * Drop a site's runtime routing keys (active deployment pointer + cached
 * manifest). Best-effort: called after the PostgreSQL mutation has committed.
 */
export async function clearDeploymentRuntimeCache(
    siteId: string,
    deploymentId?: string,
): Promise<void> {
    try {
        const pipeline = redis.multi();
        pipeline.del(redisKey(activeDeploymentMappingKey(siteId)));
        if (deploymentId) {
            pipeline.del(redisKey(manifestRedisKey(deploymentId)));
        }
        await pipeline.exec();
    } catch (err) {
        console.error(
            `[routing] runtime cache clear failed for ${siteId}; PostgreSQL remains authoritative`,
            err,
        );
    }
}

/**
 * Generate, validate, persist manifest to MinIO, and record metadata on deployment.
 * Idempotent: if manifest_key is already set, returns existing metadata.
 */
export async function generateAndPersistManifest(
    deploymentId: string,
): Promise<{
    manifest: DeploymentManifest;
    manifestKey: string;
    manifestHash: string;
    manifestSize: number;
    created: boolean;
}> {
    const [dep] = await db
        .select()
        .from(deployments)
        .where(eq(deployments.id, deploymentId))
        .limit(1);

    if (!dep) {
        throw new HttpError("Deployment not found", 404);
    }

    if (
        dep.manifestKey &&
        dep.manifestHash &&
        dep.manifestVersion &&
        dep.manifestSize
    ) {
        const body = await getManifestObject(deploymentId);
        const parsed = JSON.parse(body.toString("utf8")) as unknown;
        const check = validateDeploymentManifest(parsed, deploymentId);
        if (!check.valid) {
            throw new HttpError(`Stored manifest invalid: ${check.error}`, 500);
        }
        return {
            manifest: check.manifest,
            manifestKey: dep.manifestKey,
            manifestHash: dep.manifestHash,
            manifestSize: dep.manifestSize,
            created: false,
        };
    }

    const manifest = await buildManifestFromBlobTree(deploymentId);
    const body = serializeManifest(manifest);
    const hash = manifestContentHash(body);
    const key = manifestObjectKey(deploymentId);

    const putResult = await putManifestIfAbsent(deploymentId, body, hash);
    if (putResult === "exists") {
        const existingBody = await getManifestObject(deploymentId);
        const existingHash = manifestContentHash(existingBody);
        if (existingHash !== hash) {
            throw new HttpError(
                "Manifest object already exists with different content (immutable violation)",
                409,
            );
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
        .where(eq(deployments.id, deploymentId));

    return {
        manifest,
        manifestKey: key,
        manifestHash: hash,
        manifestSize: body.length,
        created: putResult === "created",
    };
}

export async function regenerateManifest(
    deploymentId: string,
): Promise<DeploymentManifest> {
    const result = await generateAndPersistManifest(deploymentId);
    await cacheManifestInRedis(deploymentId, result.manifest);
    return result.manifest;
}
