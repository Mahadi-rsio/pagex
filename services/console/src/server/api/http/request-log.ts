/**
 * Shared structured logging for the console API.
 *
 * Emits single-line JSON records to `console.log`/`console.error` so Cloudflare
 * Workers and any log collector can parse them without string scraping. The
 * `requestId` / `correlationId` / `buildId` / `projectId` fields make request
 * and build-pipeline events joinable across logs, traces and the runner.
 *
 * Security: never log authorization headers, cookies, tokens, passwords or
 * full request bodies. Error messages are redacted before being written.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogFields {
    timestamp?: string;
    level?: LogLevel;
    service?: string;
    environment?: string;
    worker?: string;
    deploymentRevision?: string;
    requestId?: string;
    correlationId?: string;
    traceId?: string;
    route?: string;
    method?: string;
    statusCode?: number;
    durationMs?: number;
    stage?: string;
    outcome?: string;
    errorCode?: string;
    errorName?: string;
    errorMessage?: string;
    retryable?: boolean;
    userId?: string;
    projectId?: string;
    pageId?: string;
    buildId?: string;
    deploymentId?: string;
    machineId?: string;
    queueMessageId?: string;
    rateLimitKeyType?: string;
    rateLimitDecision?: string;
    upstreamService?: string;
    upstreamStatusCode?: number;
    databaseOperation?: string;
    databaseDurationMs?: number;
    redisOperation?: string;
    redisDurationMs?: number;
    [key: string]: unknown;
}

const service = "console";
const environment =
    process.env.ENVIRONMENT || process.env.NODE_ENV || "development";
const worker = process.env.CF_WORKER_NAME || "pagex-console";
const deploymentRevision =
    process.env.CF_PAGES_DEPLOYMENT_ID || process.env.CF_REVISION_ID || "local";

/** Redact common secrets from a message before it reaches the log sink. */
export function redactLogMessage(message: string): string {
    return message
        .replace(/\bpxb\.[0-9a-fA-F-]+\.[a-f0-9]+/g, "pxb.***.***")
        .replace(/(authorization\s*:\s*bearer\s+)[^\s"']+/gi, "$1***")
        .replace(/\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, "***")
        .replace(/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, "***")
        .replace(/\b(Bearer)\s+[A-Za-z0-9._~+/-]+/gi, "$1 ***")
        .replace(
            /UPSTASH_REDIS_REST_TOKEN|BETTER_AUTH_SECRET|FLY_API_TOKEN/g,
            "***",
        );
}

function safeErrorMessage(error: unknown): string | undefined {
    if (!error) return undefined;
    const message =
        error instanceof Error
            ? error.message
            : typeof error === "string"
              ? error
              : undefined;
    return message ? redactLogMessage(message).slice(0, 2_000) : undefined;
}

export interface LogInput extends LogFields {
    error?: unknown;
}

/** Emit a structured log record. Never throws. */
export function log(input: LogInput): void {
    try {
        const record: Record<string, unknown> = {
            timestamp: input.timestamp ?? new Date().toISOString(),
            level: input.level ?? "info",
            service: input.service ?? service,
            environment: input.environment ?? environment,
            worker: input.worker ?? worker,
            deploymentRevision: input.deploymentRevision ?? deploymentRevision,
        };

        const omit = new Set(["error"]);
        for (const [key, value] of Object.entries(input)) {
            if (omit.has(key)) continue;
            if (value === undefined || value === null) continue;
            record[key] = value;
        }

        if (input.error !== undefined) {
            if (input.error instanceof Error) {
                record.errorName = input.errorName ?? input.error.name;
                record.errorMessage =
                    input.errorMessage ?? safeErrorMessage(input.error);
                if (input.error.stack && record.level === "error") {
                    record.stack = redactLogMessage(input.error.stack);
                }
            } else {
                record.errorMessage = String(input.error).slice(0, 2_000);
            }
        }

        const line = JSON.stringify(record);
        const sink =
            input.level === "error" || input.level === "warn"
                ? console.error
                : console.log;
        sink(line);
    } catch {
        // Logging must never take down a request.
    }
}

/** Convenience wrappers. */
export const structuredLog = {
    info: (fields: LogInput) => log({ ...fields, level: "info" }),
    warn: (fields: LogInput) => log({ ...fields, level: "warn" }),
    error: (fields: LogInput) => log({ ...fields, level: "error" }),
    debug: (fields: LogInput) => log({ ...fields, level: "debug" }),
};

/**
 * Derive a route label from a request URL and HTTP method. Strips dynamic path
 * segments to `:param` so logs group cleanly (e.g. `/api/builds/:id/logs`).
 */
export function routeLabel(request: Request): string {
    const { pathname, searchParams } = new URL(request.url);
    let label = pathname.replace(/[0-9a-fA-F-]{8,}/g, ":id");
    label = label.replace(/\/[^/]+$/g, (m) => (/^\/\d+$/.test(m) ? "/:id" : m));
    return `${request.method} ${label}`;
}

export interface RequestLogInput {
    requestId: string;
    request: Request;
    statusCode?: number;
    durationMs?: number;
    rateLimitDecision?: "allowed" | "blocked";
    rateLimitKeyType?: string;
    authUserId?: string;
    outcome?: string;
    error?: unknown;
    stage?: string;
}

/** Log one API request at its ownership boundary (guard / route). */
export function logRequest(input: RequestLogInput): void {
    const fields: LogInput = {
        level: input.statusCode && input.statusCode >= 500 ? "error" : "info",
        requestId: input.requestId,
        correlationId:
            input.request.headers.get("x-correlation-id") ?? input.requestId,
        route: routeLabel(input.request),
        method: input.request.method,
        statusCode: input.statusCode,
        durationMs: input.durationMs,
        outcome: input.outcome,
        stage: input.stage,
        rateLimitDecision: input.rateLimitDecision,
        rateLimitKeyType: input.rateLimitKeyType,
        userId: input.authUserId,
        error: input.error,
    };
    log(fields);
}
