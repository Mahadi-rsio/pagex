interface RouteContext {
    params: Promise<{ path: string[] }>;
}

async function handler(request: Request, context: RouteContext) {
    const { path } = await context.params;
    if (path.length === 1 && path[0] === "health") {
        return Response.json({ message: "ok" });
    }

    const { handleApiRequest } = await import("@/server/api/http/dispatcher");
    return handleApiRequest(request, path[0] === "api" ? path.slice(1) : path);
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const DELETE = handler;
export const PATCH = handler;
