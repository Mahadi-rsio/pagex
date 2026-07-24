import { db } from '../infrastructure/db/db.js'
import { blobTreeEntries, deployments, pages } from '../infrastructure/db/schema.js'
import { and, eq, ne, desc } from 'drizzle-orm'
import { HttpError } from '../utils/http-error.js'
import {
    invalidateSiteCache,
    rebuildSiteFilesMap,
} from './deploy.service.js'

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

    await activateDeployment(dep.page_id, dep.id)
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

    return updated
}

export async function listDeployments(pageId: string, tenantId: string) {
    return db
        .select()
        .from(deployments)
        .where(and(eq(deployments.page_id, pageId), eq(deployments.tenant_id, tenantId)))
        .orderBy(desc(deployments.version))
}
