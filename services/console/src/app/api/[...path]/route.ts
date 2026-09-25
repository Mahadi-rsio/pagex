interface RouteContext {
    params: Promise<{ path: string[] }>;
}

async function handler(request: Request, context: RouteContext) {
    const { path } = await context.params;
    const { handleApiRequest } = await import("@/server/api/http/dispatcher");
    return handleApiRequest(request, path);
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const DELETE = handler;
export const PATCH = handler;
