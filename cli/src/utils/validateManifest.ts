import path from "path";
import { ConfigError } from "./errors.js";

/**
 * Max number of source files in a single deploy (client fail-fast).
 * Counted before server-side Brotli/Gzip variant expansion, so at most this
 * many files can be uploaded/deployed.
 */
export const MAX_DEPLOY_FILES = 200;

/** Max size of a single file in bytes (5 MB — matches server). */
export const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;

/** Max total deploy size in bytes (200 files × 5 MB = 1000 MB — matches server). */
export const MAX_TOTAL_SIZE_BYTES = MAX_DEPLOY_FILES * MAX_FILE_SIZE_BYTES;

/**
 * Extensions blocked by the deploy API.
 * Also block .env basename; server rejects env files and MIME mismatches.
 * Images, video, PDF, and other documents/media are allowed (see server
 * file-validator for the magic-byte allow rules).
 */
export const BLOCKED_EXTENSIONS = new Set([
    // Env / secrets
    ".env",
    // Executable
    ".exe",
    ".bat",
    ".sh",
    ".bin",
    ".apk",
    ".msi",
    ".dmg",
    ".elf",
    // Archives & other
    ".iso",
    ".tar",
    ".gz",
    ".zip",
    ".rar",
    ".7z",
    ".db",
    ".sqlite",
    ".log",
]);

export interface ManifestEntry {
    path: string;
    hash: string;
    size: number;
    magicBytes: string;
}

function formatSizeMb(bytes: number): string {
    const mb = bytes / (1024 * 1024);
    return mb < 10 ? mb.toFixed(2) : mb.toFixed(1);
}

function isEnvFile(filePath: string): boolean {
    const base = path.posix.basename(filePath);
    return base === ".env" || base.startsWith(".env.");
}

/**
 * Validate a deploy manifest before calling prepare.
 * Path rules + size/extension checks so users fail fast.
 */
export function validateManifest(files: ManifestEntry[]): void {
    if (files.length > MAX_DEPLOY_FILES) {
        throw new ConfigError(
            `Deploy exceeds ${MAX_DEPLOY_FILES} file limit (found ${files.length} files)`,
        );
    }

    const totalSize = files.reduce((sum, f) => sum + f.size, 0);
    if (totalSize > MAX_TOTAL_SIZE_BYTES) {
        throw new ConfigError(
            `Deploy exceeds ${formatSizeMb(MAX_TOTAL_SIZE_BYTES)} MB total limit (${formatSizeMb(totalSize)} MB)`,
        );
    }

    const seen = new Set<string>();

    for (const file of files) {
        const filePath = file.path;

        if (!filePath || typeof filePath !== "string") {
            throw new ConfigError("File path must be a non-empty relative POSIX path");
        }

        if (filePath.startsWith("/")) {
            throw new ConfigError(`File '${filePath}' must be a relative path (no leading /)`);
        }

        if (filePath.includes("\\")) {
            throw new ConfigError(`File '${filePath}' must use POSIX path separators`);
        }

        if (filePath.split("/").includes("..")) {
            throw new ConfigError(`File '${filePath}' must not contain '..'`);
        }

        if (seen.has(filePath)) {
            throw new ConfigError(`Duplicate file path in manifest: '${filePath}'`);
        }
        seen.add(filePath);

        if (file.size > MAX_FILE_SIZE_BYTES) {
            throw new ConfigError(
                `File '${filePath}' exceeds ${formatSizeMb(MAX_FILE_SIZE_BYTES)} MB limit (${formatSizeMb(file.size)} MB)`,
            );
        }

        if (isEnvFile(filePath)) {
            throw new ConfigError(`File '${filePath}' has a blocked file type`);
        }

        const ext = path.posix.extname(filePath).toLowerCase();
        if (ext && BLOCKED_EXTENSIONS.has(ext)) {
            throw new ConfigError(`File '${filePath}' has a blocked file type`);
        }
    }
}
