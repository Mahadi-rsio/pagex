import { db } from '../infrastructure/db/db.js'
import { blobTreeEntries, blobs, deployments, pages } from '../infrastructure/db/schema.js'
import { and, eq, ne, desc } from 'drizzle-orm'
import type { PgTransaction } from 'drizzle-orm/pg-core'
import { HttpError } from '../utils/http-error.js'
import {
    invalidateSiteCache,
    rebuildSiteFilesMap,
} from './deploy.service.js'
import { enqueueDeploymentSync } from './turso-sync/sync.repository.js'
import { runDeploymentGC } from './gc.service.js'

async function activateDeploymentInTx(
    tx: PgTransaction<any, any, any>,
    pageId: string,
    deploymentId: string
): Promise<void> {
    await tx
        .update(deployments)
        .set({ is_active: true })
        .where(eq(deployments.id, deploymentId))

    await tx
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

    // Active-flag flip + Turso sync event are one transaction. A rollback is a
    // legitimate backward move of the active pointer, which is why the sync
    // worker trusts PostgreSQL's `is_active` flag rather than raw version order.
    await db.transaction(async (tx) => {
        await activateDeploymentInTx(tx, dep.page_id, dep.id)
        await enqueueDeploymentSync(tx, {
            siteId: dep.site_id,
            deploymentId: dep.id,
            version: dep.version,
        })
    })

    await rebuildSiteFilesMap(dep.site_id, dep.id)

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
