import { NextResponse } from "next/server";
import { MAX_DEPLOY_FILE_SIZE } from "@/server/api/constants/index";
import { errorMessage, errorStatus } from "@/server/api/http/guard";
import { redis, redisKey } from "@/server/api/infrastructure/cache/redis";
import {
    blobObjectKey,
    objectExists,
    objectMetaForPath,
    putObject,
} from "@/server/api/infrastructure/storage/r2";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function deployTokenKey(token: string) {
    return `deploy:token:${token}`;
}

/**
 * Token-gated blob upload endpoint that replaces S3/MinIO presigned PUTs.
 * Auth is the short-lived deployment token embedded in the query string.
 */
export async function PUT(request: Request) {
    try {
        const url = new URL(request.url);
        const token = url.searchParams.get("token");
        const hash = url.searchParams.get("hash");

        if (!token || !hash) {
            return NextResponse.json(
                { error: "token and hash query parameters are required" },
                { status: 400 },
            );
        }

        const raw = await redis.get<string>(redisKey(deployTokenKey(token)));
        if (!raw) {
            return NextResponse.json(
                { error: "Deployment token expired or invalid" },
                { status: 400 },
            );
        }

        let payload: { fileManifest?: Array<{ hash: string }> };
        try {
            payload = JSON.parse(raw) as {
                fileManifest?: Array<{ hash: string }>;
            };
        } catch {
            return NextResponse.json(
                { error: "Corrupt deployment token" },
                { status: 400 },
            );
        }

        const allowed = new Set(
            (payload.fileManifest ?? []).map((file) => file.hash),
        );
        if (!allowed.has(hash)) {
            return NextResponse.json(
                { error: `Hash ${hash} is not in the deployment manifest` },
                { status: 400 },
            );
        }

        const body = Buffer.from(await request.arrayBuffer());
        if (body.byteLength === 0) {
            return NextResponse.json(
                { error: "Empty upload body" },
                { status: 400 },
            );
        }
        if (body.byteLength > MAX_DEPLOY_FILE_SIZE) {
            return NextResponse.json(
                { error: "Upload exceeds maximum file size" },
                { status: 413 },
            );
        }

        const key = blobObjectKey(hash);
        if (!(await objectExists(key))) {
            const contentType =
                request.headers.get("content-type") ||
                "application/octet-stream";
            await putObject(key, body, objectMetaForPath(key, contentType));
        }

        return new NextResponse(null, { status: 204 });
    } catch (error) {
        console.error("deploy.blob upload failed:", error);
        return NextResponse.json(
            { error: errorMessage(error) },
            { status: errorStatus(error) },
        );
    }
}
