import axios, { type AxiosInstance, type AxiosError } from "axios";
import { config } from "../config.js";
import { NetworkError, AuthError, ConfigError, PagexError } from "../utils/errors.js";
import { jwtToken } from "../utils/jwt.js";

// ---------------------------------------------------------------------------
// Shared axios instance
// ---------------------------------------------------------------------------

/** Pull a human-readable error string from common API error body shapes. */
function extractApiErrorMessage(data: unknown, status: number): string {
    if (typeof data === "string" && data.trim()) return data.trim();

    if (data && typeof data === "object") {
        const obj = data as Record<string, unknown>;
        for (const key of ["error", "message", "detail"] as const) {
            const val = obj[key];
            if (typeof val === "string" && val.trim()) return val.trim();
        }
    }

    return `HTTP ${status}: ${JSON.stringify(data)}`;
}

export function createApiClient(): AxiosInstance {
    const instance = axios.create({
        baseURL: config.API_BASE_URL,
        timeout: 60_000,
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
    });

    // Inject auth token on every request
    instance.interceptors.request.use(async (reqConfig) => {
        const token = await jwtToken();

        reqConfig.headers = reqConfig.headers ?? {};
        reqConfig.headers["Authorization"] = `Bearer ${token}`;
        return reqConfig;
    });

    // Translate HTTP errors into typed PageX errors.
    // Errors that are already PagexErrors (e.g. AuthError from the token
    // interceptor) pass through untouched so they keep their own type/message.
    instance.interceptors.response.use(
        (res) => res,
        (err: AxiosError | PagexError) => {
            if (err instanceof PagexError) {
                return Promise.reject(err);
            }

            const status = err.response?.status;
            const data = err.response?.data;
            const message = status
                ? extractApiErrorMessage(data, status)
                : err.message;

            if (status === 401 || status === 403) {
                return Promise.reject(
                    new AuthError(
                        status === 403
                            ? message || "Forbidden. Check that you own this project."
                            : "Session expired or invalid. Please run `pagex login`.",
                    ),
                );
            }

            if (status === 400) {
                return Promise.reject(new ConfigError(message));
            }

            if (status === 404) {
                return Promise.reject(new ConfigError(message || "Resource not found."));
            }

            return Promise.reject(new NetworkError(message));
        },
    );

    return instance;
}

/** Singleton API client – import this in api sub-modules. */
export const apiClient = createApiClient();
