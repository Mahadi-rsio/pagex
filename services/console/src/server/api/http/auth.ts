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

export async function authenticateRequest(
    request: Request,
): Promise<AuthResult> {
    const authorization = request.headers.get("authorization");
    const [scheme, token, extra] = authorization?.trim().split(/\s+/) ?? [];

    if (scheme !== "Bearer" || !token || extra) {
        return {
            ok: false,
            response: Response.json(
                { error: "Missing or invalid authorization header" },
                { status: 401 },
            ),
        };
    }

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
