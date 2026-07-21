import { db } from '../infrastructure/db/db.js'
import { deployments } from '../infrastructure/db/schema.js'
import { eq, and, ne, desc } from 'drizzle-orm'
import { copyFolder, deleteFolder } from '../infrastructure/storage/minio.js'

export async function executeDeploymentFlow(
    pageId: string,
    tenantId: string,
    siteId: string,
    source: 'build' | 'upload',
    buildId: string | null,
    uploadFn: () => Promise<number>
) {
    // 1. Get next version and the currently active deployment
    const [activeDep] = await db
        .select()
        .from(deployments)
        .where(
            and(
                eq(deployments.page_id, pageId),
                eq(deployments.is_active, true)
            )
        )
        .limit(1);

    const [latestDep] = await db
        .select({ version: deployments.version })
        .from(deployments)
        .where(eq(deployments.page_id, pageId))
        .orderBy(desc(deployments.version))
        .limit(1);

    const nextVersion = latestDep ? latestDep.version + 1 : 1;
    const snapshotPrefix = `cloudisy-snapshots/${siteId}/v${nextVersion}/`;

    // Step 1: Copy current live files -> snapshot of the active version (if any)
    if (activeDep) {
        const activeSnapshotPrefix = `cloudisy-snapshots/${siteId}/v${activeDep.version}/`;
        await copyFolder(`${siteId}/`, activeSnapshotPrefix);
    }

    // Step 2: Insert a deployments row (source, is_active: false, file_count: 0 placeholder)
    const [newDep] = await db
        .insert(deployments)
        .values({
            page_id: pageId,
            site_id: siteId,
            tenant_id: tenantId,
            build_id: buildId,
            version: nextVersion,
            snapshot_prefix: snapshotPrefix,
            is_active: false,
            source,
            file_count: 0,
        })
        .returning();

    if (!newDep) {
        throw new Error("Failed to create deployment record");
    }

    // Step 3: Delete old live files
    await deleteFolder(`${siteId}/`);

    // Step 4: Upload new files to cloudisy-sites/{site_id}/
    const fileCount = await uploadFn();

    // Step 5: Set new deployment row is_active = true, set all others to false
    await db
        .update(deployments)
        .set({ is_active: true, file_count: fileCount })
        .where(eq(deployments.id, newDep.id));

    await db
        .update(deployments)
        .set({ is_active: false })
        .where(
            and(
                eq(deployments.page_id, pageId),
                ne(deployments.id, newDep.id)
            )
        );

    // Keep only the last 5 snapshots per page
    const allDeps = await db
        .select()
        .from(deployments)
        .where(eq(deployments.page_id, pageId))
        .orderBy(desc(deployments.version));

    if (allDeps.length > 5) {
        const toDelete = allDeps.slice(5);
        for (const dep of toDelete) {
            // Delete MinIO objects
            await deleteFolder(dep.snapshot_prefix);
            // Delete DB row
            await db.delete(deployments).where(eq(deployments.id, dep.id));
        }
    }

    return newDep;
}

export async function rollbackToDeployment(deploymentId: string, tenantId: string) {
    // 1. Get deployment record
    const [dep] = await db
        .select()
        .from(deployments)
        .where(
            and(
                eq(deployments.id, deploymentId),
                eq(deployments.tenant_id, tenantId)
            )
        )
        .limit(1);

    if (!dep) {
        const error = new Error("Deployment not found");
        (error as any).status = 404;
        throw error;
    }

    const pageId = dep.page_id;
    const siteId = dep.site_id;

    // 2. Find currently active deployment
    const [activeDep] = await db
        .select()
        .from(deployments)
        .where(
            and(
                eq(deployments.page_id, pageId),
                eq(deployments.is_active, true)
            )
        )
        .limit(1);

    // 3. Backup current active deployment files to snapshot (if any)
    if (activeDep) {
        const activeSnapshotPrefix = `cloudisy-snapshots/${siteId}/v${activeDep.version}/`;
        await copyFolder(`${siteId}/`, activeSnapshotPrefix);
    }

    // 4. Clean the live folder
    await deleteFolder(`${siteId}/`);

    // 5. Restore files from the snapshot of the targeted deployment
    await copyFolder(dep.snapshot_prefix, `${siteId}/`);

    // 6. Set target deployment active, and set others to inactive
    await db
        .update(deployments)
        .set({ is_active: true })
        .where(eq(deployments.id, dep.id));

    await db
        .update(deployments)
        .set({ is_active: false })
        .where(
            and(
                eq(deployments.page_id, pageId),
                ne(deployments.id, dep.id)
            )
        );

    // Return the updated deployment
    const [updated] = await db
        .select()
        .from(deployments)
        .where(eq(deployments.id, dep.id))
        .limit(1);

    return updated;
}

export async function listDeployments(pageId: string, tenantId: string) {
    const list = await db
        .select()
        .from(deployments)
        .where(
            and(
                eq(deployments.page_id, pageId),
                eq(deployments.tenant_id, tenantId)
            )
        )
        .orderBy(desc(deployments.version));

    return list;
}
