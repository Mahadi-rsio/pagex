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
        isDebug() &&
        console.log(
            "%c[ApiClient:token]",
            "color:#a78bfa;font-weight:bold",
            ...args,
        ),
    request: (...args: unknown[]) =>
        isDebug() &&
        console.log(
            "%c[ApiClient:request]",
            "color:#38bdf8;font-weight:bold",
            ...args,
        ),
    response: (...args: unknown[]) =>
        isDebug() &&
        console.log(
            "%c[ApiClient:response]",
            "color:#34d399;font-weight:bold",
            ...args,
        ),
    warn: (...args: unknown[]) =>
        console.warn(
            "%c[ApiClient:warn]",
            "color:#fbbf24;font-weight:bold",
            ...args,
        ),
    error: (...args: unknown[]) =>
        console.error(
            "%c[ApiClient:error]",
            "color:#f87171;font-weight:bold",
            ...args,
        ),
};
// ─────────────────────────────────────────────────────────────────────────────

// Types for API responses
export interface ApiPage {
    id: string;
    site_id: string;
    tenant_id: string;
    tenant_name: string;
    plan?: string;
    domain: string;
    project_name: string;
    request?: number;
    request_limit?: number;
    bandwidth_usage?: number;
    bandwidth_limit?: number;
    createdAt: string;
    updatedAt?: string;
}

export type BuildStatus = "queued" | "active" | "completed" | "failed";

export interface ApiBuild {
    id: string;
    page_id: string;
    tenant_id: string;
    job_id: string | null;
    status: BuildStatus;
    repo_url: string;
    git_provider: "github" | "gitlab";
    framework: string;
    build_command: string | null;
    output_dir: string | null;
    error: string | null;
    triggered_by: string;
    created_at: string;
    completed_at: string | null;
}

export interface ApiDeployment {
    id: string;
    page_id: string;
    site_id: string;
    tenant_id: string;
    build_id: string | null;
    version: number;
    is_active: boolean;
    source: "build" | "upload" | string;
    file_count: number;
    filesDeployed: number | null;
    filesReused: number | null;
    created_at: string;
}

export interface ApiDeploymentFile {
    path: string;
    hash: string;
    size: number;
}

export interface ApiDeploymentFilesResult {
    deployment: ApiDeployment | null;
    files: ApiDeploymentFile[];
    total_size: number;
}

export interface ApiUsage {
    requests: {
        used: number;
        limit: number;
        flushed: number;
        live: number;
    };
    bandwidth: {
        used_bytes: number;
        used_gb: string;
        flushed_bytes: number;
        live_bytes: number;
        limit_bytes: number;
        limit: string;
    };
    storage: {
        bytes: number;
        human: string;
        file_count: number;
    };
    sync: {
        pending_flush: boolean;
        interval_seconds: number;
    };
    traffic?: {
        bots: number;
        humans: number;
        unique_ips: number;
    };
    status_codes?: {
        '2xx': number;
        '3xx': number;
        '4xx': number;
        '5xx': number;
    };
    peak?: {
        hour: string | null;
        requests: number;
    };
}

export interface CreatePageInput {
    project_name: string;
}

// ─── Deploy (prepare → presign → commit) ─────────────────────────────────────

export interface DeployFileInput {
    path: string;
    hash: string;
    size: number;
    magicBytes: string;
}

export interface PrepareDeployResult {
    deploymentToken: string;
    expiresIn: number;
    uploadRequired: Array<{ path: string; hash: string; size: number }>;
    filesReused: number;
    filesToUpload: number;
    summary: {
        totalFiles: number;
        totalSize: number;
        totalSizeHuman: string;
        uploadSize: number;
        uploadSizeHuman: string;
        reusedSize: number;
    };
}

export interface PresignDeployResult {
    urls: Array<{ hash: string; url: string; method: string }>;
}

export interface CommitDeployResult {
    success: boolean;
    deployment: {
        id: string;
        page_id: string;
        site_id: string;
        version: number;
        is_active: boolean;
        source: string;
        file_count: number;
        filesDeployed: number | null;
        filesReused: number | null;
        created_at: string;
    };
    filesDeployed: number;
    filesReused: number;
    summary: {
        totalFiles: number;
        totalSize: number;
        totalSizeHuman: string;
        filesCompressed: number;
        sizeReduced: number;
        sizeReducedHuman: string;
        sizeReducedPercent: number;
        imagesOptimized: number;
        imageOriginalSize: number;
        imageOptimizedSize: number;
        imageSizeReduced: number;
        imageSizeReducedHuman: string;
        imageSizeReducedPercent: number;
        deployedFiles: number;
        compressedVariants: number;
        webpVariants: number;
    };
}

export interface TriggerBuildInput {
    pageId: string;
    repoUrl: string;
    gitProvider: "github" | "gitlab";
    gitToken?: string;
    framework: string;
    buildCommand?: string;
    outputDir?: string;
    envVars?: Record<string, string>;
}

// SSE build log event shapes
export interface BuildLogEvent {
    type: "log";
    message: string;
}
export interface BuildProgressEvent {
    type: "progress";
    value: number;
}
export interface BuildStatusEvent {
    type: "status";
    status: string;
}
export interface BuildDoneEvent {
    type: "done";
    status: "completed" | "failed";
    error?: string;
    durationMs?: number;
}
export interface BuildErrorEvent {
    type: "error";
    message: string;
}

export type BuildStreamEvent =
    | BuildLogEvent
    | BuildProgressEvent
    | BuildStatusEvent
    | BuildDoneEvent
    | BuildErrorEvent;

export interface BuildStreamHandlers {
    onLog?: (message: string) => void;
    onProgress?: (value: number) => void;
    onStatus?: (status: string) => void;
    onDone?: (event: BuildDoneEvent) => void;
    onError?: (event: BuildErrorEvent) => void;
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
        if (
            cachedToken &&
            cachedTokenExpiry &&
            Date.now() < cachedTokenExpiry
        ) {
            const expiresInSec = Math.round(
                (cachedTokenExpiry - Date.now()) / 1000,
            );
            log.token(
                "Cache HIT — reusing token, expires in",
                `${expiresInSec}s`,
                "| preview:",
                cachedToken.slice(0, 20) + "...",
            );
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
            log.token(
                "Token fetch already in-flight — awaiting existing promise",
            );
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
                    "/api/auth/token →",
                    res.status,
                    res.statusText,
                    "| ok:",
                    res.ok,
                );

                if (!res.ok) {
                    log.error(
                        "Token endpoint returned non-OK:",
                        res.status,
                        res.statusText,
                    );
                    // Log response body for extra context
                    const body = await res
                        .text()
                        .catch(() => "(unreadable body)");
                    log.error("Token error body:", body);
                    return null;
                }

                const data = await res.json();
                log.token(
                    "Token endpoint response payload keys:",
                    Object.keys(data),
                );

                if (data?.token) {
                    cachedToken = data.token;
                    cachedTokenExpiry = Date.now() + TOKEN_TTL_MS;
                    log.token(
                        "✅ Token obtained and cached for",
                        TOKEN_TTL_MS / 60_000,
                        "min",
                        "| preview:",
                        data.token.slice(0, 20) + "...",
                    );
                    return data.token;
                }

                log.warn(
                    "Token endpoint responded OK but 'token' field is missing.",
                    data,
                );
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

        const doFetch = async (
            token: string | null,
            attempt: number,
        ): Promise<Response> => {
            const headers = new Headers(options.headers);
            if (token) {
                headers.set("Authorization", `Bearer ${token}`);
            } else {
                log.warn(
                    `No token available for ${method} ${url} (attempt ${attempt}) — request will be unauthenticated`,
                );
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
            resClone
                .json()
                .then((body) => {
                    const icon = res.ok ? "✅" : "❌";
                    log.response(
                        `${icon} ${method} ${url}`,
                        `| status: ${res.status} ${res.statusText}`,
                        `| attempt: ${attempt}`,
                        "\n  body:",
                        body,
                    );
                })
                .catch(() => {
                    resClone
                        .text()
                        .then((text) => {
                            log.response(
                                `${res.ok ? "✅" : "❌"} ${method} ${url}`,
                                `| status: ${res.status} ${res.statusText}`,
                                `| attempt: ${attempt}`,
                                "\n  body (text):",
                                text,
                            );
                        })
                        .catch(() => {
                            /* empty */
                        });
                });

            return res;
        };

        try {
            const token = await this.getAuthToken();
            const response = await doFetch(token, 1);

            // If the server rejects the token, clear the cache and retry once
            // with a freshly-fetched token before giving up.
            if (response.status === 401) {
                log.warn(
                    `401 on ${method} ${url} — clearing token cache and retrying with fresh token`,
                );
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
                "\n  errorData:",
                errorData,
            );
            throw new Error(errorMessage);
        }

        const data = (await response.json()) as T;
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
     * Trigger a new cloud build from a git repository.
     */
    async triggerBuild(data: TriggerBuildInput): Promise<ApiBuild> {
        const response = await this.fetchWithAuth("/api/builds", {
            method: "POST",
            body: JSON.stringify(data),
        });
        return this.handleResponse<ApiBuild>(response);
    }

    /**
     * Open a Server-Sent Events stream of build logs.
     * The stream resolves once the connection is established; consume it with
     * `streamBuildLogs` or read the returned `Response` body directly.
     */
    async openBuildLogStream(buildId: string): Promise<Response> {
        const token = await this.getAuthToken();
        const url = `${API_BASE_URL}/api/builds/${encodeURIComponent(buildId)}/logs`;
        return fetch(url, {
            method: "GET",
            credentials: "include",
            headers: {
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
                Accept: "text/event-stream",
            },
        });
    }

    /**
     * Stream build logs, parsing SSE events and dispatching to handlers.
     * Resolves with the terminal `done` event once the stream closes.
     */
    async streamBuildLogs(
        buildId: string,
        handlers: BuildStreamHandlers,
        signal?: AbortSignal,
    ): Promise<BuildDoneEvent | null> {
        const response = await this.openBuildLogStream(buildId);

        if (!response.ok || !response.body) {
            const errorData = await response.json().catch(() => ({}));
            handlers.onError?.({
                type: "error",
                message:
                    errorData.error ||
                    `Failed to open log stream (${response.status})`,
            });
            return null;
        }

        return parseSseStream(response.body, handlers, signal);
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
     * List files from the active (or latest) deployment for a page.
     */
    async getDeploymentFiles(
        pageId: string,
    ): Promise<ApiDeploymentFilesResult> {
        const response = await this.fetchWithAuth(
            `/api/deployments/page/${pageId}/files`,
        );
        return this.handleResponse<ApiDeploymentFilesResult>(response);
    }

    /**
     * Prepare a deployment: validate a file manifest and return a
     * 10-minute deployment token plus the list of blobs still needed.
     */
    async prepareDeploy(data: {
        pageId: string;
        files: DeployFileInput[];
    }): Promise<PrepareDeployResult> {
        const response = await this.fetchWithAuth("/api/deploy/prepare", {
            method: "POST",
            body: JSON.stringify(data),
        });
        return this.handleResponse<PrepareDeployResult>(response);
    }

    /**
     * Get MinIO presigned PUT URLs for blob hashes that need uploading.
     */
    async presignDeploy(data: {
        deploymentToken: string;
        hashes: string[];
    }): Promise<PresignDeployResult> {
        const response = await this.fetchWithAuth("/api/deploy/presign", {
            method: "POST",
            body: JSON.stringify(data),
        });
        return this.handleResponse<PresignDeployResult>(response);
    }

    /**
     * Upload a raw file body to a presigned MinIO URL (no auth header needed).
     */
    async uploadBlob(
        url: string,
        file: Blob | ArrayBuffer,
        contentType?: string,
    ): Promise<void> {
        const res = await fetch(url, {
            method: "PUT",
            headers: contentType ? { "Content-Type": contentType } : undefined,
            body: file,
        });

        if (!res.ok) {
            throw new Error(`Upload failed with status ${res.status}`);
        }
    }

    /**
     * Commit a deployment: activate the tree built from uploaded blobs.
     */
    async commitDeploy(data: {
        deploymentToken: string;
    }): Promise<CommitDeployResult> {
        const response = await this.fetchWithAuth("/api/deploy/commit", {
            method: "POST",
            body: JSON.stringify(data),
        });
        return this.handleResponse<CommitDeployResult>(response);
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

// ─── SSE parser ───────────────────────────────────────────────────────────────

function parseSseStream(
    body: ReadableStream<Uint8Array>,
    handlers: BuildStreamHandlers,
    signal?: AbortSignal,
): Promise<BuildDoneEvent | null> {
    return new Promise<BuildDoneEvent | null>((resolve, reject) => {
        const reader = body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        const abortHandler = () => {
            reader.cancel().catch(() => {
                /* empty */
            });
            resolve(null);
        };
        signal?.addEventListener("abort", abortHandler, { once: true });

        const processEvents = (text: string) => {
            const events = text.split("\n\n");
            for (const event of events) {
                if (!event) continue;
                const dataLine = event
                    .split("\n")
                    .find((line) => line.startsWith("data:"));
                if (!dataLine) continue;

                const data = dataLine.slice(5).trim();
                if (!data) continue;

                try {
                    const parsed = JSON.parse(data) as BuildStreamEvent;
                    handleBuildStreamEvent(parsed, handlers);
                    if (parsed.type === "done") {
                        reader.cancel().catch(() => {
                            /* empty */
                        });
                        resolve(parsed);
                        return;
                    }
                } catch {
                    handlers.onLog?.(data);
                }
            }
        };

        const pump = async (): Promise<void> => {
            try {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) {
                        if (buffer.trim()) processEvents(buffer);
                        resolve(null);
                        return;
                    }
                    buffer += decoder.decode(value, { stream: true });
                    let boundary = buffer.lastIndexOf("\n\n");
                    if (boundary === -1) continue;
                    const chunk = buffer.slice(0, boundary);
                    buffer = buffer.slice(boundary);
                    processEvents(chunk);
                }
            } catch (err) {
                reject(
                    err instanceof Error
                        ? err
                        : new Error("Stream read failed"),
                );
            }
        };

        pump();
    });
}

function handleBuildStreamEvent(
    event: BuildStreamEvent,
    handlers: BuildStreamHandlers,
): void {
    switch (event.type) {
        case "log":
            handlers.onLog?.(event.message);
            break;
        case "progress":
            handlers.onProgress?.(event.value);
            break;
        case "status":
            handlers.onStatus?.(event.status);
            break;
        case "done":
            handlers.onDone?.(event);
            break;
        case "error":
            handlers.onError?.(event);
            break;
    }
}

// Singleton instance
export const apiClient = new ApiClient();
