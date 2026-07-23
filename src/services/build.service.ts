import { db } from '../infrastructure/db/db.js'
import { builds, pages, sites } from '../infrastructure/db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
import { buildQueue } from '../queue/jobs/build.queue.js'

export interface TriggerCloudBuildParams {
    pageId: string;
    tenantId: string;
    repoUrl: string;
    gitProvider: 'github' | 'gitlab';
    gitToken?: string | undefined;
    framework: string;
    buildCommand?: string | undefined;
    outputDir?: string | null | undefined;
    envVars?: Record<string, string> | undefined;
}

export async function triggerCloudBuild(params: TriggerCloudBuildParams) {
    // 1. Join pages + sites to verify page exists under this tenant
    const pageRecords = await db
        .select({
            pageId: pages.id,
            siteId: pages.site_id,
            tenantId: pages.tenant_id,
        })
        .from(pages)
        .innerJoin(sites, eq(pages.site_id, sites.id))
        .where(
            and(
                eq(pages.id, params.pageId),
                eq(pages.tenant_id, params.tenantId)
            )
        )
        .limit(1);

    if (pageRecords.length === 0) {
        const error = new Error("Page not found");
        (error as any).status = 404;
        throw error;
    }

    const pageRecord = pageRecords[0]!;

    // 2. Insert new build record into database
    const insertData: any = {
        page_id: params.pageId,
        tenant_id: params.tenantId,
        status: "queued",
        repo_url: params.repoUrl,
        git_provider: params.gitProvider,
        framework: params.framework,
        output_dir: params.outputDir,
    };
    if (params.buildCommand !== undefined) {
        insertData.build_command = params.buildCommand;
    }

    const [inserted] = await db
        .insert(builds)
        .values(insertData)
        .returning();

    if (!inserted) {
        throw new Error("Failed to insert build record");
    }

    // 3. Add build job to BullMQ queue
    const job = await buildQueue.add('build-job', {
        buildId: inserted.id,
        pageId: params.pageId,
        tenantId: params.tenantId,
        siteId: pageRecord.siteId,
        repoUrl: params.repoUrl,
        gitProvider: params.gitProvider,
        gitToken: params.gitToken || '',
        framework: params.framework,
        buildCommand: inserted.build_command,
        outputDir: inserted.output_dir,
        envVars: params.envVars || {},
    });

    // 4. Update the build record with the job ID
    const [updated] = await db
        .update(builds)
        .set({ job_id: job.id })
        .where(eq(builds.id, inserted.id))
        .returning();

    return updated;
}

export async function getBuildStatus(buildId: string, tenantId: string) {
    const records = await db
        .select()
        .from(builds)
        .where(
            and(
                eq(builds.id, buildId),
                eq(builds.tenant_id, tenantId)
            )
        )
        .limit(1);

    if (records.length === 0) {
        const error = new Error("Build not found");
        (error as any).status = 404;
        throw error;
    }

    return records[0]!;
}

export async function listBuilds(pageId: string, tenantId: string) {
    const list = await db
        .select()
        .from(builds)
        .where(
            and(
                eq(builds.page_id, pageId),
                eq(builds.tenant_id, tenantId)
            )
        )
        .orderBy(desc(builds.created_at))
        .limit(20);

    return list;
}
