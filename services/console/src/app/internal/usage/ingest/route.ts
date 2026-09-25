import { timingSafeEqual } from "node:crypto";

const MAX_INGEST_BODY_BYTES = 50 * 1024 * 1024;

function tokensEqual(left: string, right: string): boolean {
    const leftBuffer = Buffer.from(left);
    const rightBuffer = Buffer.from(right);
    return (
        leftBuffer.length === rightBuffer.length &&
        timingSafeEqual(leftBuffer, rightBuffer)
    );
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request) {
    const token = process.env.USAGE_INGEST_TOKEN;
    if (!token) {
        return Response.json(
            { error: "USAGE_INGEST_TOKEN not configured" },
            { status: 500 },
        );
    }

    const authorization = request.headers.get("authorization");
    const suppliedToken = authorization?.startsWith("Bearer ")
        ? authorization.slice("Bearer ".length)
        : "";
    if (!suppliedToken || !tokensEqual(suppliedToken, token)) {
        return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const contentLength = Number(request.headers.get("content-length") || "0");
    if (
        Number.isFinite(contentLength) &&
        contentLength > MAX_INGEST_BODY_BYTES
    ) {
        return Response.json({ error: "Payload too large" }, { status: 413 });
    }

    const body = await request.text();
    if (Buffer.byteLength(body, "utf8") > MAX_INGEST_BODY_BYTES) {
        return Response.json({ error: "Payload too large" }, { status: 413 });
    }
    if (body.trim().length === 0) {
        return Response.json({ error: "Empty body" }, { status: 400 });
    }

    const { ingestUsage, parseIngestBody } = await import(
        "@/features/usage/usage-ingest.service"
    );
    let records: unknown[];
    try {
        records = parseIngestBody(JSON.parse(body));
    } catch {
        records = parseIngestBody(body);
    }

    if (records.length === 0) {
        return Response.json(
            { error: "No valid records in payload" },
            { status: 400 },
        );
    }

    try {
        const result = await ingestUsage(records);
        return Response.json({ ok: true, ...result });
    } catch (error) {
        console.error(
            "[usage-ingest] failed:",
            error instanceof Error ? error.message : error,
        );
        return Response.json(
            { error: "Failed to ingest usage" },
            { status: 500 },
        );
    }
}
