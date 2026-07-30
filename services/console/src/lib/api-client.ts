

// Proxy base - all API calls route through the Next.js proxy handler
const API_BASE_URL = "/api/proxy";

// Cache for the auth token to avoid repeated fetches
let cachedToken: string | null = null;
let tokenFetchPromise: Promise<string | null> | null = null;

// Types for API responses
export interface ApiPage {
    id: string;
    site_id: string;
    tenant_id: string;
    tenant_name: string;
    project_name: string;
    domain: string;
    createdAt: string;
    updatedAt: string;
}

export interface ApiBuild {
    id: string;
    pageId: string;
    status: "queued" | "active" | "completed" | "failed";
    repositoryUrl?: string;
    branch?: string;
    commitHash?: string;
    logs?: string;
    createdAt: string;
    completedAt?: string;
}

export interface ApiDeployment {
    id: string;
    siteId: string;
    pageId: string;
    isActive: boolean;
    createdAt: string;
    filesDeployed: number;
    filesReused: number;
}

export interface ApiUsage {
    requests: {
        used: number;
        limit: number;
    };
    bandwidth: {
        used_gb: string;
        limit: string;
    };
}

export interface CreatePageInput {
    project_name: string;
}

export interface ApiResponse<T> {
    success: boolean;
    data?: T;
    error?: string;
    message?: string;
}

export interface ApiError {
    error: {
        code: string;
        message: string;
        details?: Record<string, unknown>;
    };
}

/**
 * API Client for communicating with the PageX API Service
 * Handles authentication via Better Auth JWT tokens
 */
export class ApiClient {
    /**
     * Clear the cached auth token (call this after logout)
     */
    clearAuthToken(): void {
        cachedToken = null;
    }

    private async getAuthToken(): Promise<string | null> {
        // Return cached token if available
        if (cachedToken) {
            return cachedToken;
        }

        // If a fetch is already in progress, wait for it
        if (tokenFetchPromise) {
            return tokenFetchPromise;
        }

        tokenFetchPromise = (async () => {
            try {
                // authClient.token() is not typed on ReactAuthClient (jwtClient only
                // exposes jwks() on the client type). Call the server endpoint directly.
                const res = await fetch("/api/auth/token", {
                    method: "GET",
                    credentials: "include",
                });

                if (!res.ok) {
                    console.error("Failed to get auth token:", res.statusText);
                    return null;
                }

                const data = await res.json();

                if (data?.token) {
                    cachedToken = data.token;
                    return data.token;
                }

                console.warn("No JWT token found in token response");
                return null;
            } catch (error) {
                console.error("Failed to get auth token:", error);
                return null;
            } finally {
                tokenFetchPromise = null;
            }
        })();

        return tokenFetchPromise;
    }

    private async fetchWithAuth(
        endpoint: string,
        options: RequestInit = {},
    ): Promise<Response> {
        const token = await this.getAuthToken();

        const headers = new Headers(options.headers);
        if (token) {
            headers.set("Authorization", `Bearer ${token}`);
        }
        headers.set("Content-Type", "application/json");

        const url = `${API_BASE_URL}${endpoint}`;

        try {
            const response = await fetch(url, {
                ...options,
                headers,
                credentials: "include",
            });

            return response;
        } catch (error) {
            console.error(`API request failed for ${url}:`, error);
            throw new Error(
                `Network error: ${error instanceof Error ? error.message : "Unknown error"}`,
            );
        }
    }

    private async handleResponse<T>(response: Response): Promise<T> {
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            const errorMessage =
                errorData.error || errorData.message || "Unknown error";
            throw new Error(errorMessage);
        }

        return response.json() as Promise<T>;
    }

    // ==================== PAGES ENDPOINTS ====================

    /**
     * Get all pages/projects for the current user
     */
    async getPages(): Promise<ApiPage[]> {
        const response = await this.fetchWithAuth("/api/pages");
        return this.handleResponse<ApiPage[]>(response);
    }

    /**
     * Create a new page/project
     */
    async createPage(data: CreatePageInput): Promise<ApiPage> {
        const response = await this.fetchWithAuth("/api/pages/create", {
            method: "POST",
            body: JSON.stringify(data),
        });
        return this.handleResponse<ApiPage>(response);
    }

    /**
     * Delete a page/project
     */
    async deletePage(pageId: string): Promise<{ success: boolean }> {
        const response = await this.fetchWithAuth(`/api/pages/${pageId}`, {
            method: "DELETE",
        });
        return this.handleResponse<{ success: boolean }>(response);
    }

    /**
     * Get usage statistics for a specific domain
     */
    async getPageUsage(domain: string): Promise<ApiUsage> {
        const response = await this.fetchWithAuth(
            `/api/pages/usage/${encodeURIComponent(domain)}`,
        );
        return this.handleResponse<ApiUsage>(response);
    }

    // ==================== BUILDS ENDPOINTS ====================

    /**
     * Get all builds for a specific page
     */
    async getBuilds(pageId: string): Promise<ApiBuild[]> {
        const response = await this.fetchWithAuth(`/api/builds/page/${pageId}`);
        return this.handleResponse<ApiBuild[]>(response);
    }

    /**
     * Get build status by build ID
     */
    async getBuildStatus(buildId: string): Promise<ApiBuild> {
        const response = await this.fetchWithAuth(`/api/builds/${buildId}`);
        return this.handleResponse<ApiBuild>(response);
    }

    /**
     * Get build logs
     */
    async getBuildLogs(buildId: string): Promise<{ logs: string }> {
        const response = await this.fetchWithAuth(
            `/api/builds/${buildId}/logs`,
        );
        return this.handleResponse<{ logs: string }>(response);
    }

    /**
     * Trigger a new build
     */
    async triggerBuild(data: {
        pageId: string;
        repoUrl?: string;
        branch?: string;
    }): Promise<ApiBuild> {
        const response = await this.fetchWithAuth("/api/builds", {
            method: "POST",
            body: JSON.stringify(data),
        });
        return this.handleResponse<ApiBuild>(response);
    }

    // ==================== DEPLOYMENT ENDPOINTS ====================

    /**
     * Get deployments for a specific page
     */
    async getDeployments(pageId: string): Promise<ApiDeployment[]> {
        const response = await this.fetchWithAuth(
            `/api/deployments/page/${pageId}`,
        );
        return this.handleResponse<ApiDeployment[]>(response);
    }

    /**
     * Prepare a deployment
     */
    async prepareDeploy(data: {
        pageId: string;
        siteId: string;
        files: Array<{ path: string; content: string }>;
    }): Promise<{ uploadUrl: string; deploymentId: string }> {
        const response = await this.fetchWithAuth("/api/deploy/prepare", {
            method: "POST",
            body: JSON.stringify(data),
        });
        return this.handleResponse<{ uploadUrl: string; deploymentId: string }>(
            response,
        );
    }

    /**
     * Commit a deployment
     */
    async commitDeploy(deploymentId: string): Promise<{ success: boolean }> {
        const response = await this.fetchWithAuth("/api/deploy/commit", {
            method: "POST",
            body: JSON.stringify({ deploymentId }),
        });
        return this.handleResponse<{ success: boolean }>(response);
    }

    /**
     * Rollback to a previous deployment
     */
    async rollback(deploymentId: string): Promise<{ success: boolean }> {
        const response = await this.fetchWithAuth(
            `/api/deployments/${deploymentId}/rollback`,
            {
                method: "POST",
            },
        );
        return this.handleResponse<{ success: boolean }>(response);
    }

    // ==================== HEALTH CHECK ====================

    /**
     * Check API service health
     */
    async healthCheck(): Promise<{ message: string }> {
        const response = await this.fetchWithAuth("/health");
        return this.handleResponse<{ message: string }>(response);
    }
}

// Singleton instance
export const apiClient = new ApiClient();
