import { toNextJsHandler } from "better-auth/next-js";
import { getAuthInstance } from "@/modules/auth/utils/auth-utils";

// Always-allowed dev origins — safe to keep hardcoded
const DEV_ORIGINS = [
    "http://localhost:3000",
    "http://localhost:5173",
    "http://127.0.0.1:3000",
    "http://127.0.0.1:5173",
];

function getAllowedOrigins(): string[] {
    const envOrigins = (process.env.BETTER_AUTH_TRUSTED_ORIGINS || "")
        .split(",")
        .map((o) => o.trim())
        .filter(Boolean);
    return [...new Set([...envOrigins, ...DEV_ORIGINS])];
}

function buildCorsHeaders(origin: string | null): Record<string, string> {
    const allowed = getAllowedOrigins();
    const isAllowed = !!origin && allowed.includes(origin);

    if (!isAllowed) return {};

    return {
        "Access-Control-Allow-Origin": origin!,
        "Access-Control-Allow-Credentials": "true",
        "Access-Control-Allow-Methods":
            "GET, POST, PUT, PATCH, DELETE, OPTIONS",
        "Access-Control-Allow-Headers":
            "Content-Type, Authorization, Cookie, X-Requested-With",
        Vary: "Origin",
    };
}

function withCors(response: Response, origin: string | null): Response {
    const headers = buildCorsHeaders(origin);
    if (Object.keys(headers).length === 0) return response;

    // Clone response so headers are mutable
    const next = new Response(response.body, response);
    for (const [key, value] of Object.entries(headers)) {
        next.headers.set(key, value);
    }
    return next;
}

const createHandler = async () => {
    const auth = await getAuthInstance();
    return toNextJsHandler(auth.handler);
};

export async function GET(request: Request) {
    const { GET: handler } = await createHandler();
    const response = await handler(request);
    return withCors(response, request.headers.get("origin"));
}

export async function POST(request: Request) {
    const { POST: handler } = await createHandler();
    const response = await handler(request);
    return withCors(response, request.headers.get("origin"));
}

export async function OPTIONS(request: Request) {
    const origin = request.headers.get("origin");
    const headers = buildCorsHeaders(origin);
    return new Response(null, { status: 204, headers });
}
