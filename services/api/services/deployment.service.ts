import { db } from '../infrastructure/db/db.js'
import { blobTreeEntries, blobs, deployments, pages } from '../infrastructure/db/schema.js'
import { and, eq, ne, desc } from 'drizzle-orm'
import { HttpError } from '../utils/http-error.js'
import {
    invalidateSiteCache,
} from './deploy.service.js'
import {
    cacheManifestInRedis,
    generateAndPersistManifest,
    incrementSiteVersion,
    setActiveDeploymentCache,
} from './manifest.service.js'
import { runDeploymentGC } from './gc.service.js'
import {
    DEPLOY_LOCK_COMMIT_TTL_SECONDS,
    pageDeploymentLock,
} from './deployment-lock.service.js'

export async function rollbackToDeployment(deploymentId: string, tenantId: string) {
    const [dep] = await db
        .select()
        .from(deployments)
        .where(and(eq(deployments.id, deploymentId), eq(deployments.tenant_id, tenantId)))
        .limit(1)

    if (!dep) {
        throw new HttpError('Deployment not found', 404)
    }

    const [anyEntry] = await db
        .select({ id: blobTreeEntries.id })
        .from(blobTreeEntries)
        .where(eq(blobTreeEntries.deploymentId, dep.id))
        .limit(1)

    if (!anyEntry) {
        throw new HttpError('Deployment has no blob tree; cannot rollback', 400)
    }

    // Cannot rollback to a failed deployment
    if (dep.status === 'failed') {
        throw new HttpError('Cannot rollback to a failed deployment', 400)
    }

    const lockHolder = `rollback:${dep.id}`

    return pageDeploymentLock.withLock(
        dep.page_id,
        lockHolder,
        DEPLOY_LOCK_COMMIT_TTL_SECONDS,
        async () => {
            // Safety: a deployment is only eligible to become active once its immutable
            // manifest exists and is valid. generateAndPersistManifest throws on any
            // generation/storage failure, so the current active deployment stays live.
            const { manifest } = await generateAndPersistManifest(dep.id)

            await pageDeploymentLock.assertHeld(dep.page_id, lockHolder)

            // ATOMIC ACTIVATION: Use a database transaction
            const activatedDeployment = await db.transaction(async (tx) => {
                // Find current active deployment for this page
                const [currentActive] = await tx
                    .select({ id: deployments.id })
                    .from(deployments)
                    .where(and(eq(deployments.page_id, dep.page_id), eq(deployments.is_active, true)))
                    .limit(1)

                // Mark rollback deployment as active
                await tx
                    .update(deployments)
                    .set({
                        is_active: true,
                        status: 'active',
                    })
                    .where(eq(deployments.id, dep.id))

                // Mark previous active deployment as superseded
                if (currentActive && currentActive.id !== dep.id) {
                    await tx
                        .update(deployments)
                        .set({
                            is_active: false,
                            status: 'superseded',
                        })
                        .where(eq(deployments.id, currentActive.id))
                }

                const [updated] = await tx
                    .select()
                    .from(deployments)
                    .where(eq(deployments.id, dep.id))
                    .limit(1)

                if (!updated) {
                    throw new HttpError('Failed to activate deployment', 500)
                }

                return updated
            })

            // Redis updates ONLY after successful DB commit
            await setActiveDeploymentCache(dep.site_id, activatedDeployment.id)
            await cacheManifestInRedis(activatedDeployment.id, manifest)
            await incrementSiteVersion(dep.site_id)

            const [page] = await db.select().from(pages).where(eq(pages.id, dep.page_id)).limit(1)
            if (page) {
                await invalidateSiteCache(page.project_name)
            }

            // fire and forget — never await
            runDeploymentGC(dep.page_id, dep.site_id).catch((err) =>
                console.error('GC failed silently', err)
            )

            return activatedDeployment
        },
    )
}

export async function listDeployments(pageId: string, tenantId: string) {
    return db
        .select()
        .from(deployments)
        .where(and(eq(deployments.page_id, pageId), eq(deployments.tenant_id, tenantId)))
        .orderBy(desc(deployments.version))
}

export async function listPageDeploymentFiles(pageId: string, tenantId: string) {
    const [active] = await db
        .select()
        .from(deployments)
        .where(
            and(
                eq(deployments.page_id, pageId),
                eq(deployments.tenant_id, tenantId),
                eq(deployments.is_active, true),
            ),
        )
        .limit(1)

    const deployment =
        active ??
        (
            await db
                .select()
                .from(deployments)
                .where(
                    and(
                        eq(deployments.page_id, pageId),
                        eq(deployments.tenant_id, tenantId),
                    ),
                )
                .orderBy(desc(deployments.version))
                .limit(1)
        )[0]

    if (!deployment) {
        return {
            deployment: null,
            files: [] as Array<{ path: string; hash: string; size: number }>,
            total_size: 0,
        }
    }

    const files = await db
        .select({
            path: blobTreeEntries.path,
            hash: blobTreeEntries.blobHash,
            size: blobs.size,
        })
        .from(blobTreeEntries)
        .innerJoin(blobs, eq(blobTreeEntries.blobHash, blobs.hash))
        .where(eq(blobTreeEntries.deploymentId, deployment.id))
        .orderBy(blobTreeEntries.path)

    const total_size = files.reduce((sum, f) => sum + (f.size || 0), 0)

    return { deployment, files, total_size }
}
