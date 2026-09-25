import { NextResponse } from "next/server";
import {
    authenticateRequest,
    type AuthContext,
} from "./auth";
import { checkPublicRateLimit, withRateLimitHeaders } from "./rate-limit";

/**
 * Wrap a route handler with the shared API boundary: rate limiting and
 * authentication (CLI JWT or browser session). Resolves once; the inner
 * handler receives the authenticated tenant and must not re-authenticate.
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
            return withRateLimitHeaders(
                authentication.response,
                rateLimit.headers,
            );
        }

        return withRateLimitHeaders(
            await handler(request, authentication.auth, context),
            rateLimit.headers,
        );
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
