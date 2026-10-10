import { createRemoteJWKSet, jwtVerify } from "jose";
import { isBuildJobToken } from "@/features/builds/job-token.service";

/** Scope attached when a request is authenticated with a build job token. */
export interface BuildJobScope {
    buildId: string;
    pageId: string;
}

export interface AuthContext {
    id: string;
    name: string;
    /**
     * Present only for machine requests authenticated with a build job token.
     * Deploy routes use it to pin the request to a single project.
     */
    job?: BuildJobScope;
}

type AuthResult =
    | { ok: true; auth: AuthContext }
    | { ok: false; response: Response };

const jwksByUrl = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function getJwks(url: string) {
    const existing = jwksByUrl.get(url);
    if (existing) return existing;

    const jwks = createRemoteJWKSet(new URL(url));
    jwksByUrl.set(url, jwks);
    return jwks;
}

/**
 * Authenticate a request at the API boundary. Supports both flows:
 *
 *  - CLI:   `Authorization: Bearer <jwt>` verified against Better Auth's JWKS.
 *  - Browser: session cookie resolved through Better Auth's session API.
 *
 * Both resolve to an `AuthContext` (`{ id, name }`) that feature services
 * receive as the authenticated tenant. No re-verification happens downstream.
 */
export async function authenticateRequest(
    request: Request,
): Promise<AuthResult> {
    const authorization = request.headers.get("authorization");
    const [scheme, token, extra] = authorization?.trim().split(/\s+/) ?? [];

    if (scheme === "Bearer" && token && !extra) {
        if (isBuildJobToken(token)) {
            return verifyBuildJobToken(token);
        }
        return verifyJwt(token, request);
    }

    return getSessionFromCookie(request);
}

/**
 * Verify a build job token (`pxb.<buildId>.<secret>`).
 *
 * Resolves to the job's tenant and a `job` scope. The token only works while
 * the build is `active` and unexpired, so a finished build's credential is
 * dead. No user session/JWT is ever involved in the machine path.
 */
async function verifyBuildJobToken(token: string): Promise<AuthResult> {
    try {
        const { loadBuildTokenRecord } = await import(
            "@/features/builds/build.store"
        );
        const { parseJobToken, verifyJobTokenAgainstRecord } = await import(
            "@/features/builds/job-token.service"
        );

        const parts = parseJobToken(token);
        if (!parts) return unauthorized();

        const record = await loadBuildTokenRecord(parts.buildId);
        const buildId = verifyJobTokenAgainstRecord(token, record);
        if (!buildId || !record) return unauthorized();

        return {
            ok: true,
            auth: {
                id: record.tenant_id,
                name: "build-machine",
                job: { buildId, pageId: record.page_id },
            },
        };
    } catch (error) {
        console.error("Build job token verification failed:", error);
        return unauthorized();
    }
}

function unauthorized(): AuthResult {
    return {
        ok: false,
        response: Response.json(
            { error: "Invalid or expired token" },
            { status: 401 },
        ),
    };
}

async function verifyJwt(token: string, request: Request): Promise<AuthResult> {
    try {
        const jwksUrl =
            process.env.AUTH_JWKS_URL ||
            new URL("/api/auth/jwks", request.url).toString();
        const { payload } = await jwtVerify(token, getJwks(jwksUrl));

        if (
            typeof payload.id !== "string" ||
            typeof payload.name !== "string"
        ) {
            return {
                ok: false,
                response: Response.json(
                    { error: "Invalid or expired token" },
                    { status: 401 },
                ),
            };
        }

        return {
            ok: true,
            auth: { id: payload.id, name: payload.name },
        };
    } catch (error) {
        console.error("Token verification failed:", error);
        return {
            ok: false,
            response: Response.json(
                { error: "Invalid or expired token" },
                { status: 401 },
            ),
        };
    }
}

async function getSessionFromCookie(request: Request): Promise<AuthResult> {
    const { getAuthInstance } = await import("@/modules/auth/utils/auth-utils");

    try {
        const auth = await getAuthInstance();
        const session = await auth.api.getSession({
            headers: request.headers,
        });

        if (session?.user?.id && session?.user?.name) {
            return {
                ok: true,
                auth: { id: session.user.id, name: session.user.name },
            };
        }
    } catch (error) {
        console.error("Session verification failed:", error);
    }

    return {
        ok: false,
        response: Response.json(
            { error: "Missing or invalid authorization header" },
            { status: 401 },
        ),
    };
}
