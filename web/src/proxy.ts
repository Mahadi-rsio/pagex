import { NextRequest, NextResponse } from "next/server";

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

function getCorsHeaders(origin: string | null): HeadersInit {
    const allowedOrigins = getAllowedOrigins();
    const isAllowed = origin && allowedOrigins.includes(origin);

    return {
        "Access-Control-Allow-Origin": isAllowed
            ? origin
            : (allowedOrigins[0] ?? "*"),
        "Access-Control-Allow-Methods":
            "GET, POST, PUT, PATCH, DELETE, OPTIONS",
        "Access-Control-Allow-Headers":
            "Content-Type, Authorization, Cookie, X-Requested-With",
        "Access-Control-Allow-Credentials": "true",
        "Access-Control-Max-Age": "86400",
        Vary: "Origin",
    };
}

export function proxy(request: NextRequest) {
    const origin = request.headers.get("origin");

    // Handle preflight OPTIONS requests
    if (request.method === "OPTIONS") {
        return new NextResponse(null, {
            status: 204,
            headers: getCorsHeaders(origin),
        });
    }

    // Pass through and attach CORS headers to auth API responses
    const response = NextResponse.next();
    const corsHeaders = getCorsHeaders(origin);
    for (const [key, value] of Object.entries(corsHeaders)) {
        response.headers.set(key, value);
    }

    return response;
}

export const config = {
    matcher: ["/api/auth/:path*"],
};
