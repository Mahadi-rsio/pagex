import { apiClient } from "./client.js";
import type { ManifestEntry } from "../utils/validateManifest.js";
import { NetworkError } from "../utils/errors.js";

// ---------------------------------------------------------------------------
// Prepare — POST /api/deploy/prepare
// ---------------------------------------------------------------------------

export interface PrepareSummary {
    totalFiles: number;
    totalSize: number;
    totalSizeHuman: string;
    uploadSize: number;
    uploadSizeHuman: string;
    reusedSize: number;
}

export interface UploadRequiredFile {
    path: string;
    hash: string;
    size: number;
}

export interface PrepareRequest {
    pageId: string;
    files: Array<Pick<ManifestEntry, "path" | "hash" | "size" | "magicBytes">>;
}

export interface PrepareResponse {
    deploymentToken: string;
    expiresIn: number;
    uploadRequired: UploadRequiredFile[];
    filesReused: number;
    filesToUpload: number;
    summary: PrepareSummary;
}

/**
 * Validate manifest server-side, check existing blobs, issue a 10-minute token.
 */
export async function prepareDeploy(body: PrepareRequest): Promise<PrepareResponse> {
    const response = await apiClient.post<PrepareResponse>("/api/deploy/prepare", body);
    return response.data;
}

// ---------------------------------------------------------------------------
// Presign — POST /api/deploy/presign
// ---------------------------------------------------------------------------

export interface PresignRequest {
    deploymentToken: string;
    hashes: string[];
}

export interface PresignUrl {
    hash: string;
    url: string;
    method: "PUT" | string;
}

export interface PresignResponse {
    urls: PresignUrl[];
}

/**
 * Obtain MinIO presigned PUT URLs for blob hashes that still need uploading.
 */
export async function presignUploads(body: PresignRequest): Promise<PresignUrl[]> {
    const response = await apiClient.post<PresignResponse>("/api/deploy/presign", body);
    return response.data.urls ?? [];
}

/**
 * PUT raw file bytes to a presigned URL (no API auth header).
 * Avoids setting Content-Type so signatures that omit it still match.
 */
export async function putPresigned(url: string, body: Buffer): Promise<void> {
    const res = await fetch(url, {
        method: "PUT",
        body: new Uint8Array(body),
    });

    if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new NetworkError(
            `Blob upload failed (HTTP ${res.status})${text ? `: ${text}` : ""}`,
        );
    }
}

// ---------------------------------------------------------------------------
// Commit — POST /api/deploy/commit
// ---------------------------------------------------------------------------

export interface CommitSummary {
    totalFiles: number;
    totalSize: number;
    totalSizeHuman: string;
    filesCompressed: number;
    sizeReduced: number;
    sizeReducedHuman: string;
    sizeReducedPercent: number;
    imagesOptimized: number;
    imageOriginalSize: number;
    imageOptimizedSize: number;
    imageSizeReduced: number;
    imageSizeReducedHuman: string;
    imageSizeReducedPercent: number;
    /** Tree size including compression / WebP variants. */
    deployedFiles: number;
    compressedVariants: number;
    webpVariants: number;
}

export interface DeploymentInfo {
    id?: string;
    page_id?: string;
    site_id?: string;
    version?: number | string;
    is_active?: boolean;
    source?: string;
    file_count?: number;
    filesDeployed?: number;
    filesReused?: number;
    created_at?: string;
    [key: string]: unknown;
}

export interface CommitResponse {
    success: boolean;
    deployment?: DeploymentInfo;
    filesDeployed: number;
    filesReused: number;
    summary: CommitSummary;
}

/**
 * Finalize deployment after blobs are uploaded.
 * Server runs Brotli/Gzip/WebP optimization at this step.
 */
export async function commitDeploy(deploymentToken: string): Promise<CommitResponse> {
    const response = await apiClient.post<CommitResponse>("/api/deploy/commit", {
        deploymentToken,
    });
    return response.data;
}
