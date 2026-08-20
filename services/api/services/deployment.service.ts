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
    buildManifestFromBlobTree,
} from './manifest.service.js'
import { runDeploymentGC } from './gc.service.js'

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

    if (!dep.manifestKey) {
        await generateAndPersistManifest(dep.id)
    }

    await activateDeployment(dep.page_id, dep.id)
    await setActiveDeploymentCache(dep.site_id, dep.id)

    const manifest = await buildManifestFromBlobTree(dep.id)
    await cacheManifestInRedis(dep.id, manifest)
    await incrementSiteVersion(dep.site_id)

    const [page] = await db.select().from(pages).where(eq(pages.id, dep.page_id)).limit(1)
    if (page) {
        await invalidateSiteCache(page.project_name)
    }

    const [updated] = await db
        .select()
        .from(deployments)
        .where(eq(deployments.id, dep.id))
        .limit(1)

    // fire and forget — never await
    runDeploymentGC(dep.page_id, dep.site_id).catch((err) =>
        console.error('GC failed silently', err)
    )

    return updated
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
