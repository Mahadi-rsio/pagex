import path from "path";
import { ConfigError } from "./errors.js";

/** Max number of files in a single deploy (client fail-fast). */
export const MAX_DEPLOY_FILES = 100;

/** Max size of a single file in bytes (50 MB — matches server). */
export const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024;

/** Max total deploy size in bytes (250 MB — matches server). */
export const MAX_TOTAL_SIZE_BYTES = 250 * 1024 * 1024;

/**
 * Extensions blocked by the deploy API.
 * Also block .env basename; server rejects env files and MIME mismatches.
 */
export const BLOCKED_EXTENSIONS = new Set([
    // Env / secrets
    ".env",
    // PDF
    ".pdf",
    // Video
    ".mp4",
    ".mkv",
    ".avi",
    ".mov",
    ".webm",
    ".flv",
    ".wmv",
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
            `Deploy exceeds 250 MB total limit (${formatSizeMb(totalSize)} MB)`,
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
                `File '${filePath}' exceeds 50 MB limit (${formatSizeMb(file.size)} MB)`,
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
