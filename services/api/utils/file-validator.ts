import path from 'node:path'
import { fileTypeFromBuffer } from 'file-type'
import { HttpError } from './http-error.js'

const BLOCKED_EXTS = new Set([
    'env',
    'exe', 'dll', 'so', 'dylib', 'bin',
    'bat', 'cmd', 'com', 'msi', 'scr',
    'sh', 'bash', 'zsh', 'ps1', 'psm1',
    'php', 'phtml', 'asp', 'aspx', 'jsp', 'cgi',
    'zip', 'tar', 'gz', 'tgz', 'bz2', 'xz', '7z', 'rar',
    'iso', 'img', 'dmg',
    'apk', 'deb', 'rpm',
])

const BLOCKED_MIME = new Set([
    'application/x-msdownload',
    'application/x-msdos-program',
    'application/x-executable',
    'application/x-sharedlib',
    'application/x-mach-binary',
    'application/x-elf',
    'application/x-sh',
    'application/x-bat',
    'application/x-ms-installer',
    'application/zip',
    'application/x-zip-compressed',
    'application/gzip',
    'application/x-gzip',
    'application/x-tar',
    'application/x-7z-compressed',
    'application/x-rar-compressed',
    'application/vnd.rar',
    'application/x-bzip2',
    'application/x-xz',
])

/** Extensions allowed when magic-byte MIME detection finds nothing (text / web assets). */
const ALLOWED_TEXT_EXTS = new Set([
    'html', 'htm', 'css', 'js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx',
    'json', 'map', 'txt', 'md', 'markdown', 'csv', 'tsv',
    'svg', 'xml', 'xhtml', 'webmanifest', 'ico',
    'woff', 'woff2', 'ttf', 'otf', 'eot',
    'yml', 'yaml', 'toml', 'ini', 'cfg', 'conf',
    'wasm', 'txt', 'liquid', 'njk', 'hbs',
])

/** file-type `ext` → acceptable filename extensions */
const EXT_ALIASES: Record<string, readonly string[]> = {
    jpg: ['jpg', 'jpeg'],
    jpeg: ['jpg', 'jpeg'],
    tif: ['tif', 'tiff'],
    tiff: ['tif', 'tiff'],
    htm: ['htm', 'html'],
    html: ['htm', 'html'],
    // SVGs often start with <?xml …> so file-type reports "xml"
    xml: ['xml', 'svg', 'xhtml'],
    svg: ['svg', 'xml'],
}

function extractExtension(filename: string): string {
    const base = path.basename(filename).toLowerCase()
    if (!base || base === '.' || base === '..') {
        throw new HttpError(`Invalid filename: ${filename}`, 400)
    }

    // Dotfiles like `.env` — path.extname returns ''
    if (base.startsWith('.') && !base.slice(1).includes('.')) {
        return base.slice(1)
    }

    const ext = path.extname(base).slice(1)
    return ext
}

function extensionsMatch(fileExt: string, detectedExt: string): boolean {
    if (fileExt === detectedExt) return true
    const aliases = EXT_ALIASES[detectedExt]
    return aliases ? aliases.includes(fileExt) : false
}

/**
 * Validate a deploy file via extension denylist + magic-byte MIME detection.
 * `magicBytes` is base64 of the first 16 bytes of the file.
 */
export async function validateFile(
    magicBytes: string,
    filename: string,
    size: number,
    maxSize: number
): Promise<void> {
    if (!Number.isFinite(size) || size <= 0) {
        throw new HttpError(`Invalid file size for ${filename}`, 400)
    }
    if (size > maxSize) {
        throw new HttpError(
            `File ${filename} exceeds max size of ${maxSize} bytes`,
            400
        )
    }

    // 1. Extract extension
    const ext = extractExtension(filename)

    // 2. Blocked extension → throw immediately
    if (BLOCKED_EXTS.has(ext)) {
        throw new HttpError(`Blocked file extension: .${ext}`, 400)
    }

    // Also block common secret filenames regardless of path nesting
    const base = path.basename(filename).toLowerCase()
    if (base === '.env' || base.startsWith('.env.')) {
        throw new HttpError('Blocked file: environment files are not allowed', 400)
    }

    // 3. Decode magicBytes base64 → Buffer (expect 16 bytes; allow shorter for tiny files)
    let buffer: Buffer
    try {
        buffer = Buffer.from(magicBytes, 'base64')
    } catch {
        throw new HttpError(`Invalid magicBytes for ${filename}`, 400)
    }
    if (buffer.length === 0) {
        throw new HttpError(`Empty magicBytes for ${filename}`, 400)
    }
    if (buffer.length > 16) {
        buffer = buffer.subarray(0, 16)
    }

    // 4. Detect MIME from magic bytes
    const detected = await fileTypeFromBuffer(buffer)

    // 5. Blocked MIME → throw
    if (detected?.mime && BLOCKED_MIME.has(detected.mime)) {
        throw new HttpError(
            `Blocked file type (${detected.mime}) for ${filename}`,
            400
        )
    }

    // 6. No MIME → must be an allowed text/web extension
    if (!detected) {
        if (!ALLOWED_TEXT_EXTS.has(ext)) {
            throw new HttpError(
                `Unrecognized file type for ${filename}; extension .${ext} is not allowed`,
                400
            )
        }
        return
    }

    // 7. MIME detected but extension mismatches → throw
    if (!extensionsMatch(ext, detected.ext)) {
        throw new HttpError(
            `Extension mismatch for ${filename}: expected .${detected.ext}, got .${ext}`,
            400
        )
    }
}
