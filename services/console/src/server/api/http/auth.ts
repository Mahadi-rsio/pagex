import { createRemoteJWKSet, jwtVerify } from "jose";

export interface AuthContext {
    id: string;
    name: string;
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
        return verifyJwt(token, request);
    }

    return getSessionFromCookie(request);
}

async function verifyJwt(
    token: string,
    request: Request,
): Promise<AuthResult> {
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
    const { getAuthInstance } = await import(
        "@/modules/auth/utils/auth-utils"
    );

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
