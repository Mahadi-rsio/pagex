

// Proxy base - all API calls route through the Next.js proxy handler
const API_BASE_URL = "/api/proxy";

// Cache for the auth token to avoid repeated fetches
let cachedToken: string | null = null;
let cachedTokenExpiry: number | null = null; // epoch ms when the cached token expires
let tokenFetchPromise: Promise<string | null> | null = null;

// Refresh the token 1 minute before the server-side 20-minute expiry
const TOKEN_TTL_MS = 19 * 60 * 1000;

// ─── Debug logger ────────────────────────────────────────────────────────────
// Set  window.__API_DEBUG = true  in the browser console to enable verbose logs.
const isDebug = (): boolean =>
    typeof window !== "undefined" &&
    (window as unknown as Record<string, unknown>)["__API_DEBUG"] === true;

const log = {
    token: (...args: unknown[]) =>
        isDebug() && console.log("%c[ApiClient:token]", "color:#a78bfa;font-weight:bold", ...args),
    request: (...args: unknown[]) =>
        isDebug() && console.log("%c[ApiClient:request]", "color:#38bdf8;font-weight:bold", ...args),
    response: (...args: unknown[]) =>
        isDebug() && console.log("%c[ApiClient:response]", "color:#34d399;font-weight:bold", ...args),
    warn: (...args: unknown[]) =>
        console.warn("%c[ApiClient:warn]", "color:#fbbf24;font-weight:bold", ...args),
    error: (...args: unknown[]) =>
        console.error("%c[ApiClient:error]", "color:#f87171;font-weight:bold", ...args),
};
// ─────────────────────────────────────────────────────────────────────────────

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
        cachedTokenExpiry = null;
    }

    private async getAuthToken(): Promise<string | null> {
        // Return cached token if it's still valid
        if (cachedToken && cachedTokenExpiry && Date.now() < cachedTokenExpiry) {
            const expiresInSec = Math.round((cachedTokenExpiry - Date.now()) / 1000);
            log.token("Cache HIT — reusing token, expires in", `${expiresInSec}s`,
                "| preview:", cachedToken.slice(0, 20) + "...");
            return cachedToken;
        }

        // Invalidate a stale/expired token
        if (cachedToken) {
            log.token("Cache EXPIRED — discarding stale token");
        } else {
            log.token("Cache MISS — no token cached yet");
        }
        cachedToken = null;
        cachedTokenExpiry = null;

        // If a fetch is already in progress, wait for it
        if (tokenFetchPromise) {
            log.token("Token fetch already in-flight — awaiting existing promise");
            return tokenFetchPromise;
        }

        tokenFetchPromise = (async () => {
            try {
                log.token("Fetching fresh JWT from /api/auth/token …");
                // authClient.token() is not typed on ReactAuthClient (jwtClient only
                // exposes jwks() on the client type). Call the server endpoint directly.
                const res = await fetch("/api/auth/token", {
                    method: "GET",
                    credentials: "include",
                });

                log.token(
                    "/api/auth/token →", res.status, res.statusText,
                    "| ok:", res.ok,
                );

                if (!res.ok) {
                    log.error("Token endpoint returned non-OK:", res.status, res.statusText);
                    // Log response body for extra context
                    const body = await res.text().catch(() => "(unreadable body)");
                    log.error("Token error body:", body);
                    return null;
                }

                const data = await res.json();
                log.token("Token endpoint response payload keys:", Object.keys(data));

                if (data?.token) {
                    cachedToken = data.token;
                    cachedTokenExpiry = Date.now() + TOKEN_TTL_MS;
                    log.token(
                        "✅ Token obtained and cached for", TOKEN_TTL_MS / 60_000, "min",
                        "| preview:", data.token.slice(0, 20) + "...",
                    );
                    return data.token;
                }

                log.warn("Token endpoint responded OK but 'token' field is missing.", data);
                return null;
            } catch (error) {
                log.error("Exception while fetching auth token:", error);
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
        const url = `${API_BASE_URL}${endpoint}`;
        const method = options.method ?? "GET";

        const doFetch = async (token: string | null, attempt: number): Promise<Response> => {
            const headers = new Headers(options.headers);
            if (token) {
                headers.set("Authorization", `Bearer ${token}`);
            } else {
                log.warn(`No token available for ${method} ${url} (attempt ${attempt}) — request will be unauthenticated`);
            }
            headers.set("Content-Type", "application/json");

            log.request(
                `→ ${method} ${url}`,
                `| attempt: ${attempt}`,
                `| token: ${token ? `"${token.slice(0, 20)}..."` : "null"}`,
                ...(options.body ? ["|  body:", options.body] : []),
            );

            const res = await fetch(url, {
                ...options,
                headers,
                credentials: "include",
            });

            // Clone so we can read body for logging without consuming the stream
            const resClone = res.clone();
            resClone.json()
                .then((body) => {
                    const icon = res.ok ? "✅" : "❌";
                    log.response(
                        `${icon} ${method} ${url}`,
                        `| status: ${res.status} ${res.statusText}`,
                        `| attempt: ${attempt}`,
                        "\n  body:", body,
                    );
                })
                .catch(() => {
                    resClone.text().then((text) => {
                        log.response(
                            `${res.ok ? "✅" : "❌"} ${method} ${url}`,
                            `| status: ${res.status} ${res.statusText}`,
                            `| attempt: ${attempt}`,
                            "\n  body (text):", text,
                        );
                    }).catch(() => {/* empty */});
                });

            return res;
        };

        try {
            const token = await this.getAuthToken();
            const response = await doFetch(token, 1);

            // If the server rejects the token, clear the cache and retry once
            // with a freshly-fetched token before giving up.
            if (response.status === 401) {
                log.warn(`401 on ${method} ${url} — clearing token cache and retrying with fresh token`);
                cachedToken = null;
                cachedTokenExpiry = null;
                const freshToken = await this.getAuthToken();
                return doFetch(freshToken, 2);
            }

            return response;
        } catch (error) {
            log.error(`Network error on ${method} ${url}:`, error);
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
            log.error(
                `handleResponse: non-OK response ${response.status} ${response.url}`,
                "\n  errorData:", errorData,
            );
            throw new Error(errorMessage);
        }

        const data = await response.json() as T;
        log.response("handleResponse: parsed OK response", "\n  data:", data);
        return data;
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
