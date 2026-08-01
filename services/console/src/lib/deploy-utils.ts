import type { DeployFileInput } from "@/lib/api-client";

export interface SelectedDeployFile {
    path: string;
    file: File;
}

/**
 * Compute the lowercase hex SHA256 of a File.
 */
export async function hashFile(file: File): Promise<string> {
    const buffer = await file.arrayBuffer();
    const digest = await crypto.subtle.digest("SHA-256", buffer);
    return Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
}

/**
 * Base64 of the first 16 bytes of a File (magic bytes for MIME/extension checks).
 */
export async function readMagicBytes(file: File): Promise<string> {
    const head = file.slice(0, 16);
    const buffer = await head.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (const byte of bytes) {
        binary += String.fromCharCode(byte);
    }
    return btoa(binary);
}

/**
 * Build a DeployFileInput manifest entry for a File.
 */
export async function buildDeployFile(file: File): Promise<DeployFileInput> {
    const [hash, magicBytes] = await Promise.all([
        hashFile(file),
        readMagicBytes(file),
    ]);
    return {
        path: file.name,
        hash,
        size: file.size,
        magicBytes,
    };
}
