import { promises as fs } from 'node:fs'
import path from 'node:path'

const MAX_FILE_COUNT = 100
const MAX_SINGLE_FILE_BYTES = 10 * 1024 * 1024

const BLOCKED_EXTENSIONS = new Set([
    // PDF
    '.pdf',
    // Video
    '.mp4', '.mkv', '.avi', '.mov', '.webm', '.flv', '.wmv',
    // Executable
    '.exe', '.bat', '.sh', '.bin', '.apk', '.msi', '.dmg', '.elf',
    // Non-standard
    '.iso', '.tar', '.gz', '.zip', '.rar', '.7z', '.db', '.sqlite', '.log',
])

export type ValidationResult =
    | { valid: true }
    | { valid: false; error: string }

export interface ManifestFile {
    path: string
    size: number
}

function extensionOf(filePath: string): string {
    return path.extname(filePath).toLowerCase()
}

function formatSizeMb(bytes: number): string {
    return (bytes / (1024 * 1024)).toFixed(2)
}

/**
 * Validate a deploy file list (CLI / prepare — no disk access).
 */
export function validateManifest(files: ManifestFile[]): ValidationResult {
    if (files.length > MAX_FILE_COUNT) {
        return {
            valid: false,
            error: `Deploy exceeds 100 file limit (found ${files.length} files)`,
        }
    }

    for (const file of files) {
        if (file.size > MAX_SINGLE_FILE_BYTES) {
            return {
                valid: false,
                error: `File '${file.path}' exceeds 10 MB limit (${formatSizeMb(file.size)} MB)`,
            }
        }

        const ext = extensionOf(file.path)
        if (ext && BLOCKED_EXTENSIONS.has(ext)) {
            return {
                valid: false,
                error: `File '${file.path}' has a blocked file type`,
            }
        }
    }

    return { valid: true }
}

async function collectFilesRecursive(
    dirPath: string,
    rootDir: string
): Promise<ManifestFile[]> {
    const entries = await fs.readdir(dirPath, { withFileTypes: true })
    const files: ManifestFile[] = []

    for (const entry of entries) {
        const absolute = path.join(dirPath, entry.name)
        if (entry.isDirectory()) {
            files.push(...(await collectFilesRecursive(absolute, rootDir)))
            continue
        }
        if (!entry.isFile()) continue

        const stat = await fs.stat(absolute)
        const relativePath = path
            .relative(rootDir, absolute)
            .split(path.sep)
            .join('/')

        files.push({ path: relativePath, size: stat.size })
    }

    return files
}

/**
 * Validate a build output directory by reading it recursively from disk.
 */
export async function validateOutputDir(dirPath: string): Promise<ValidationResult> {
    try {
        const files = await collectFilesRecursive(dirPath, dirPath)
        return validateManifest(files)
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err)
        return { valid: false, error: `Failed to read output directory: ${message}` }
    }
}
