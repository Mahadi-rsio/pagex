import { NextResponse } from "next/server";
import { handleBlobUpload } from "@/features/deployments/blob-upload.service";
import { errorDetails } from "@/server/api/http/guard";
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
 * Only the URL shape is ever logged — never the query string, which carries
 * the short-lived deployment token.
 */
function requestTarget(request: Request): {
    protocol: string | null;
    hostname: string | null;
    port: string | null;
} {
    try {
        const url = new URL(request.url);
        return {
            protocol: url.protocol,
            hostname: url.hostname,
            port: url.port,
        };
    } catch {
        return { protocol: null, hostname: null, port: null };
    }
}

/**
 * Token-gated blob upload endpoint that replaces S3/MinIO presigned PUTs.
 * Auth is the short-lived deployment token embedded in the query string.
 * All validation lives in `handleBlobUpload`.
 */
export async function PUT(request: Request) {
    try {
        return await handleBlobUpload(request, {
            loadToken: (token) =>
                redis.get<string>(redisKey(deployTokenKey(token))),
            objectExists,
            objectKey: blobObjectKey,
            putObject: (key, body, contentType) =>
                putObject(key, body, objectMetaForPath(key, contentType)),
        });
    } catch (error) {
        console.error("[api/deploy/blob] upload failed", {
            ...requestTarget(request),
            error: errorDetails(error),
        });
        return NextResponse.json(
            { error: "Failed to store blob" },
            { status: 500 },
        );
    }
}
