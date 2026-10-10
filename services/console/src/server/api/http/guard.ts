import { NextResponse } from "next/server";
import { type AuthContext, authenticateRequest } from "./auth";
import {
    buildRateLimitedResponse,
    checkInternalRateLimit,
    checkPublicRateLimit,
    type RateLimitDecision,
} from "./rate-limit";
import { logRequest } from "./request-log";

/**
 * Wrap a route handler with the shared API boundary: authentication, then the
 * rate-limit policy that matches the authenticated identity.
 *
 * The build runner calls the machine endpoints (`heartbeat`, `logs`,
 * `complete`) and the deploy endpoints with a per-job build token. All of those
 * requests originate from one shared Fly egress IP, so applying the public
 * per-IP quota would let a chatty build's log traffic starve its own heartbeats
 * and completion calls. We therefore authenticate *first* and:
 *
 *  - build-job requests  -> internal per-build quota (keyed by build id)
 *  - tenant / browser     -> public per-IP quota (unchanged)
 *  - unauthenticated      -> public per-IP quota (anti-abuse)
 *
 * The inner handler receives the authenticated tenant and must not
 * re-authenticate.
 */
export function withApiAuth(
    handler: (
        request: Request,
        auth: AuthContext,
        context: { params: Promise<Record<string, string>> },
    ) => Promise<Response>,
): (
    request: Request,
    context: { params: Promise<Record<string, string>> },
) => Promise<Response> {
    return async (
        request: Request,
        context: { params: Promise<Record<string, string>> },
    ): Promise<Response> => {
        const startedAt = Date.now();
        const requestId =
            request.headers.get("x-request-id") || crypto.randomUUID();

        const authentication = await authenticateRequest(request);

        let decision: RateLimitDecision;
        if (authentication.ok && authentication.auth.job) {
            // Build machine request: apply the internal per-build policy so
            // machine traffic is not throttled by the shared egress IP quota.
            decision = await checkInternalRateLimit(
                authentication.auth.job.buildId,
            );
        } else {
            decision = await checkPublicRateLimit(request);
        }

        if (decision.blocked) {
            const response = buildRateLimitedResponse(decision);
            logRequest({
                requestId,
                request,
                statusCode: 429,
                durationMs: Date.now() - startedAt,
                rateLimitDecision: "blocked",
                rateLimitKeyType: decision.keyType,
                authUserId: authentication.ok
                    ? authentication.auth.id
                    : undefined,
                outcome: "rate_limited",
            });
            return response;
        }

        if (!authentication.ok) {
            const response = authentication.response;
            logRequest({
                requestId,
                request,
                statusCode: response.status,
                durationMs: Date.now() - startedAt,
                rateLimitDecision: "allowed",
                rateLimitKeyType: decision.keyType,
                outcome: "unauthorized",
            });
            return response;
        }

        try {
            const response = await handler(
                request,
                authentication.auth,
                context,
            );
            logRequest({
                requestId,
                request,
                statusCode: response.status,
                durationMs: Date.now() - startedAt,
                rateLimitDecision: "allowed",
                rateLimitKeyType: decision.keyType,
                authUserId: authentication.auth.id,
                outcome: "handled",
            });
            return response;
        } catch (error) {
            const status = errorStatus(error);
            const message = errorMessage(error);
            logRequest({
                requestId,
                request,
                statusCode: status,
                durationMs: Date.now() - startedAt,
                rateLimitDecision: "allowed",
                rateLimitKeyType: decision.keyType,
                authUserId: authentication.auth.id,
                outcome: "error",
                error,
            });
            // Preserve a 4xx error thrown by a handler (e.g. HttpError) as-is;
            // anything else becomes a sanitized 500.
            if (status >= 400 && status <= 499) {
                return NextResponse.json({ error: message }, { status });
            }
            return NextResponse.json(
                { error: "Internal Server Error" },
                { status: 500 },
            );
        }
    };
}

/** Shared helper to parse a JSON body, returning a 400 response on bad JSON. */
export async function readJsonBody<T>(
    request: Request,
): Promise<{ ok: true; value: T } | { ok: false; response: Response }> {
    try {
        return { ok: true, value: (await request.json()) as T };
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

/** Derive an HTTP status from an error that carries a `status` field. */
export function errorStatus(error: unknown): number {
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

export function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : "Internal Server Error";
}

/**
 * Plain-object snapshot of an error for structured logging. Surfaces the
 * driver-level fields (pg `code`/`detail`/`constraint`, Drizzle call site,
 * nested `cause`) that a bare `console.error(error)` hides in Workers logs.
 * Never send this to clients.
 */
export function errorDetails(error: unknown): Record<string, unknown> {
    if (!(error instanceof Error)) {
        return { message: String(error) };
    }

    const driver = error as Error & {
        code?: unknown;
        detail?: unknown;
        hint?: unknown;
        constraint?: unknown;
        table?: unknown;
        column?: unknown;
        cause?: unknown;
    };

    const details: Record<string, unknown> = {
        name: error.name,
        message: error.message,
    };
    if (driver.code !== undefined) details.code = driver.code;
    if (driver.detail !== undefined) details.detail = driver.detail;
    if (driver.hint !== undefined) details.hint = driver.hint;
    if (driver.constraint !== undefined) details.constraint = driver.constraint;
    if (driver.table !== undefined) details.table = driver.table;
    if (driver.column !== undefined) details.column = driver.column;
    if (driver.cause !== undefined) {
        details.cause =
            driver.cause instanceof Error
                ? `${driver.cause.name}: ${driver.cause.message}`
                : String(driver.cause);
    }
    if (error.stack) details.stack = error.stack;

    return details;
}
