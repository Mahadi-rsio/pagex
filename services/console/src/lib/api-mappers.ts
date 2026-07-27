import type { Project } from "@/store/useAppStore";
import type { ApiPage, ApiBuild, ApiDeployment } from "./api-client";

/**
 * Map API Page response to Console Project model
 */
export function mapApiPageToProject(apiPage: ApiPage): Project {
    return {
        id: apiPage.id,
        name: apiPage.project_name,
        description: undefined, // Can be enhanced later
        repo: undefined, // Can be enhanced later
        provider: undefined, // Can be enhanced later
        status: "active", // Default status, can be mapped from API if available
        domain: apiPage.domain,
        createdAt: apiPage.createdAt,
        updatedAt: apiPage.updatedAt,
    };
}

/**
 * Map array of API Pages to Console Projects
 */
export function mapApiPagesToProjects(apiPages: ApiPage[]): Project[] {
    return apiPages.map(mapApiPageToProject);
}

/**
 * Map Console Project to API CreatePageInput
 */
export function mapProjectToCreatePageInput(project: {
    name: string;
    description?: string;
}): { project_name: string } {
    return {
        project_name: project.name,
    };
}

/**
 * Get project status based on builds and deployments
 * This is a placeholder for more sophisticated status mapping
 */
export function getProjectStatus(
    builds: ApiBuild[] = [],
    deployments: ApiDeployment[] = [],
): Project["status"] {
    // Check if there are active builds
    const hasActiveBuild = builds.some(
        (build) => build.status === "active" || build.status === "queued",
    );
    if (hasActiveBuild) return "building";

    // Check if there are error builds
    const hasErrorBuild = builds.some((build) => build.status === "failed");
    if (hasErrorBuild) return "error";

    // Check if there are active deployments
    const hasActiveDeployment = deployments.some(
        (deployment) => deployment.isActive,
    );
    if (hasActiveDeployment) return "active";

    return "inactive";
}

/**
 * Enhanced project mapping with builds and deployments data
 */
export function mapApiPageToEnhancedProject(
    apiPage: ApiPage,
    builds: ApiBuild[] = [],
    deployments: ApiDeployment[] = [],
): Project {
    const baseProject = mapApiPageToProject(apiPage);

    return {
        ...baseProject,
        status: getProjectStatus(builds, deployments),
    };
}

/**
 * Filter builds by page ID
 */
export function filterBuildsByPageId(
    builds: ApiBuild[],
    pageId: string,
): ApiBuild[] {
    return builds.filter((build) => build.pageId === pageId);
}

/**
 * Filter deployments by page ID
 */
export function filterDeploymentsByPageId(
    deployments: ApiDeployment[],
    pageId: string,
): ApiDeployment[] {
    return deployments.filter((deployment) => deployment.pageId === pageId);
}
