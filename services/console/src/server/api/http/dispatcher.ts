import { NextResponse } from "next/server";
import { authenticateRequest } from "./auth";
import { checkPublicRateLimit, withRateLimitHeaders } from "./rate-limit";

const UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type ApiRouteName =
    | "pages.list"
    | "pages.create"
    | "pages.usage"
    | "pages.delete"
    | "deploy.prepare"
    | "deploy.presign"
    | "deploy.commit"
    | "deployments.rollback"
    | "deployments.files"
    | "deployments.list"
    | "usage.site"
    | "usage.siteMetrics"
    | "usage.project"
    | "usage.account"
    | "usage.quota";

interface RouteMatch {
    name: ApiRouteName;
    values: Record<string, string>;
}

type JsonResult =
    | { ok: true; value: unknown }
    | { ok: false; response: Response };

function matchRoute(method: string, path: string[]): RouteMatch | null {
    if (path[0] === "pages") {
        if (path.length === 1 && method === "GET") {
            return { name: "pages.list", values: {} };
        }
        if (path.length === 2 && path[1] === "create" && method === "POST") {
            return { name: "pages.create", values: {} };
        }
        if (path.length === 3 && path[1] === "usage" && method === "GET") {
            return { name: "pages.usage", values: { domain: path[2]! } };
        }
        if (path.length === 2 && method === "DELETE") {
            return { name: "pages.delete", values: { pageId: path[1]! } };
        }
    }

    if (path[0] === "deploy" && path.length === 2 && method === "POST") {
        if (path[1] === "prepare") {
            return { name: "deploy.prepare", values: {} };
        }
        if (path[1] === "presign") {
            return { name: "deploy.presign", values: {} };
        }
        if (path[1] === "commit") {
            return { name: "deploy.commit", values: {} };
        }
    }

    if (path[0] === "deployments") {
        if (path.length === 3 && path[2] === "rollback" && method === "POST") {
            return {
                name: "deployments.rollback",
                values: { deploymentId: path[1]! },
            };
        }
        if (
            path.length === 4 &&
            path[1] === "page" &&
            path[3] === "files" &&
            method === "GET"
        ) {
            return {
                name: "deployments.files",
                values: { pageId: path[2]! },
            };
        }
        if (path.length === 3 && path[1] === "page" && method === "GET") {
            return {
                name: "deployments.list",
                values: { pageId: path[2]! },
            };
        }
    }

    if (path[0] === "v1" && path.length === 4 && method === "GET") {
        if (path[1] === "sites" && path[3] === "usage") {
            return {
                name: "usage.site",
                values: { siteId: path[2]! },
            };
        }
        if (path[1] === "sites" && path[3] === "metrics") {
            return {
                name: "usage.siteMetrics",
                values: { siteId: path[2]! },
            };
        }
        if (path[1] === "projects" && path[3] === "usage") {
            return {
                name: "usage.project",
                values: { projectId: path[2]! },
            };
        }
    }

    if (
        path[0] === "v1" &&
        path[1] === "account" &&
        path.length === 3 &&
        method === "GET"
    ) {
        if (path[2] === "usage") {
            return { name: "usage.account", values: {} };
        }
        if (path[2] === "quota") {
            return { name: "usage.quota", values: {} };
        }
    }

    return null;
}

async function readJson(request: Request): Promise<JsonResult> {
    try {
        return { ok: true, value: await request.json() };
    } catch {
        return {
            ok: false,
            response: NextResponse.json(
                { error: "Invalid JSON body" },
                { status: 400 },
            ),
        };
    }
}

function errorStatus(error: unknown): number {
    if (error && typeof error === "object" && "status" in error) {
        const status = (error as { status: unknown }).status;
        if (
            typeof status === "number" &&
            Number.isInteger(status) &&
            status >= 400 &&
            status <= 599
        ) {
            return status;
        }
    }
    return 500;
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : "Internal Server Error";
}

async function executeRoute(
    request: Request,
    route: RouteMatch,
    tenantId: string,
    tenantName: string,
): Promise<Response> {
    switch (route.name) {
        case "pages.list": {
            const { getListPages } = await import(
                "@/server/api/services/page.service"
            );
            try {
                return NextResponse.json(await getListPages(tenantId));
            } catch (error) {
                console.error(error);
                return NextResponse.json(
                    { error: "Internal Server Error" },
                    { status: 500 },
                );
            }
        }
        case "pages.create": {
            const body = await readJson(request);
            if (!body.ok) return body.response;

            const { createPageSchema } = await import(
                "@/server/api/validators/page.validator"
            );
            const validation = createPageSchema.safeParse(body.value);
            if (!validation.success) {
                return NextResponse.json(
                    { error: validation.error.format() },
                    { status: 400 },
                );
            }

            const { createPage } = await import(
                "@/server/api/services/page.service"
            );
            try {
                return NextResponse.json(
                    await createPage(
                        { project_name: validation.data.project_name },
                        { tenant_id: tenantId, tenant_name: tenantName },
                    ),
                );
            } catch (error) {
                console.error(error);
                return NextResponse.json(
                    { error: "Internal Server Error" },
                    { status: 500 },
                );
            }
        }
        case "pages.usage": {
            const { getPageUsage } = await import(
                "@/server/api/services/page.service"
            );
            try {
                const usage = await getPageUsage(route.values.domain!);
                if (!usage) {
                    return NextResponse.json(
                        { error: "Domain not found" },
                        { status: 404 },
                    );
                }
                return NextResponse.json(usage);
            } catch (error) {
                console.error(
                    "Usage fetch failed for",
                    route.values.domain,
                    ":",
                    error,
                );
                return NextResponse.json(
                    { error: "Failed to fetch usage" },
                    { status: 500 },
                );
            }
        }
        case "pages.delete": {
            const { deletePage } = await import(
                "@/server/api/services/page.service"
            );
            try {
                const result = await deletePage(route.values.pageId!, tenantId);
                if ("error" in result) {
                    return NextResponse.json(result, {
                        status: result.error === "Forbidden" ? 403 : 404,
                    });
                }
                return NextResponse.json(result);
            } catch (error) {
                console.error(error);
                return NextResponse.json(
                    { error: "Internal Server Error" },
                    { status: 500 },
                );
            }
        }
        case "deploy.prepare":
        case "deploy.presign":
        case "deploy.commit": {
            const body = await readJson(request);
            if (!body.ok) return body.response;

            const validators = await import(
                "@/server/api/validators/deploy.validator"
            );
            const service = await import(
                "@/server/api/services/deploy.service"
            );

            if (route.name === "deploy.prepare") {
                const validation = validators.prepareDeploySchema.safeParse(
                    body.value,
                );
                if (!validation.success) {
                    return NextResponse.json(
                        { error: validation.error.format() },
                        { status: 400 },
                    );
                }
                try {
                    return NextResponse.json(
                        await service.prepareDeploy(validation.data, tenantId),
                    );
                } catch (error) {
                    console.error("deploy.prepare failed:", error);
                    return NextResponse.json(
                        { error: errorMessage(error) },
                        { status: errorStatus(error) },
                    );
                }
            }

            if (route.name === "deploy.presign") {
                const validation = validators.presignDeploySchema.safeParse(
                    body.value,
                );
                if (!validation.success) {
                    return NextResponse.json(
                        { error: validation.error.format() },
                        { status: 400 },
                    );
                }
                try {
                    return NextResponse.json(
                        await service.presignDeploy(validation.data, tenantId),
                    );
                } catch (error) {
                    console.error("deploy.presign failed:", error);
                    return NextResponse.json(
                        { error: errorMessage(error) },
                        { status: errorStatus(error) },
                    );
                }
            }

            const validation = validators.commitDeploySchema.safeParse(
                body.value,
            );
            if (!validation.success) {
                return NextResponse.json(
                    { error: validation.error.format() },
                    { status: 400 },
                );
            }
            try {
                return NextResponse.json(
                    await service.commitDeploy(validation.data, tenantId),
                );
            } catch (error) {
                console.error("deploy.commit failed:", error);
                return NextResponse.json(
                    { error: errorMessage(error) },
                    { status: errorStatus(error) },
                );
            }
        }
        case "deployments.rollback": {
            const { rollbackToDeployment } = await import(
                "@/server/api/services/deployment.service"
            );
            try {
                const deployment = await rollbackToDeployment(
                    route.values.deploymentId!,
                    tenantId,
                );
                return NextResponse.json({
                    success: true,
                    message: "Rollback successful",
                    deployment,
                });
            } catch (error) {
                console.error("Rollback failed:", error);
                return NextResponse.json(
                    { error: errorMessage(error) },
                    { status: errorStatus(error) },
                );
            }
        }
        case "deployments.files":
        case "deployments.list": {
            const service = await import(
                "@/server/api/services/deployment.service"
            );
            try {
                const result =
                    route.name === "deployments.files"
                        ? await service.listPageDeploymentFiles(
                              route.values.pageId!,
                              tenantId,
                          )
                        : await service.listDeployments(
                              route.values.pageId!,
                              tenantId,
                          );
                return NextResponse.json(result);
            } catch (error) {
                console.error(
                    route.name === "deployments.files"
                        ? "List deployment files failed:"
                        : "List deployments failed:",
                    error,
                );
                return NextResponse.json(
                    { error: errorMessage(error) },
                    { status: errorStatus(error) },
                );
            }
        }
        case "usage.site":
        case "usage.project": {
            const idKey = route.name === "usage.site" ? "siteId" : "projectId";
            const id = route.values[idKey]!;
            if (!UUID_RE.test(id)) {
                return NextResponse.json(
                    {
                        error:
                            route.name === "usage.site"
                                ? "Invalid site id"
                                : "Invalid project id",
                    },
                    { status: 400 },
                );
            }

            const { getProjectUsage, getSiteUsage } = await import(
                "@/server/api/services/usage.service"
            );
            try {
                const usage =
                    route.name === "usage.site"
                        ? await getSiteUsage(id, tenantId)
                        : await getProjectUsage(id, tenantId);
                if (!usage) {
                    return NextResponse.json(
                        {
                            error:
                                route.name === "usage.site"
                                    ? "Site not found"
                                    : "Project not found",
                        },
                        { status: 404 },
                    );
                }
                return NextResponse.json(usage);
            } catch (error) {
                console.error("Usage fetch failed:", error);
                return NextResponse.json(
                    { error: "Failed to fetch usage" },
                    { status: 500 },
                );
            }
        }
        case "usage.siteMetrics": {
            const siteId = route.values.siteId!;
            if (!UUID_RE.test(siteId)) {
                return NextResponse.json(
                    { error: "Invalid site id" },
                    { status: 400 },
                );
            }

            const url = new URL(request.url);
            const query: { window?: string; from?: string; to?: string } = {};
            const window = url.searchParams.get("window");
            const from = url.searchParams.get("from");
            const to = url.searchParams.get("to");
            if (window !== null) query.window = window;
            if (from !== null) query.from = from;
            if (to !== null) query.to = to;

            const [{ getSiteMetrics }, { resolveMetricsWindow }] =
                await Promise.all([
                    import("@/server/api/services/usage.service"),
                    import("@/server/api/utils/metrics"),
                ]);
            const metricsWindow = resolveMetricsWindow(query);
            try {
                const metrics = await getSiteMetrics(
                    siteId,
                    tenantId,
                    metricsWindow,
                );
                if (!metrics) {
                    return NextResponse.json(
                        { error: "Site not found" },
                        { status: 404 },
                    );
                }
                return NextResponse.json({
                    ...metrics,
                    window: {
                        start: metricsWindow.start.toISOString(),
                        end: metricsWindow.end.toISOString(),
                    },
                });
            } catch (error) {
                console.error("Site metrics failed:", error);
                return NextResponse.json(
                    { error: "Failed to fetch metrics" },
                    { status: 500 },
                );
            }
        }
        case "usage.account":
        case "usage.quota": {
            const { getAccountQuota, getAccountUsage } = await import(
                "@/server/api/services/usage.service"
            );
            try {
                const result =
                    route.name === "usage.account"
                        ? await getAccountUsage(tenantId)
                        : await getAccountQuota(tenantId);
                return NextResponse.json(result);
            } catch (error) {
                console.error("Account usage request failed:", error);
                return NextResponse.json(
                    {
                        error:
                            route.name === "usage.account"
                                ? "Failed to fetch usage"
                                : "Failed to fetch quota",
                    },
                    { status: 500 },
                );
            }
        }
    }
}

export async function handleApiRequest(
    request: Request,
    path: string[],
): Promise<Response> {
    const route = matchRoute(request.method.toUpperCase(), path);
    if (!route) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const rateLimit = await checkPublicRateLimit(request);
    if (rateLimit.blocked) {
        return withRateLimitHeaders(
            NextResponse.json(
                { error: "Too many requests, please try again later" },
                { status: 429 },
            ),
            rateLimit.headers,
        );
    }

    const authentication = await authenticateRequest(request);
    if (!authentication.ok) {
        return withRateLimitHeaders(authentication.response, rateLimit.headers);
    }

    return withRateLimitHeaders(
        await executeRoute(
            request,
            route,
            authentication.auth.id,
            authentication.auth.name,
        ),
        rateLimit.headers,
    );
}
