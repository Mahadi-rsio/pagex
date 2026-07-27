// File utilities

import { promises as fs } from 'node:fs';
import { join, dirname, extname, basename } from 'node:path';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';

export interface FileStats {
  path: string;
  size: number;
  isFile: boolean;
  isDirectory: boolean;
  modifiedAt: Date;
  createdAt: Date;
}

export interface FileInfo {
  path: string;
  filename: string;
  extension: string;
  directory: string;
  size: number;
  contentType: string;
  hash: string;
}

/**
 * Check if a path exists
 */
export async function pathExists(path: string): Promise<boolean> {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get file statistics
 */
export async function getFileStats(path: string): Promise<FileStats> {
  const stats = await fs.stat(path);
  return {
    path,
    size: stats.size,
    isFile: stats.isFile(),
    isDirectory: stats.isDirectory(),
    modifiedAt: stats.mtime,
    createdAt: stats.birthtime
  };
}

/**
 * Read file content
 */
export async function readFile(path: string): Promise<Buffer> {
  return fs.readFile(path);
}

/**
 * Write file content
 */
export async function writeFile(path: string, content: string | Buffer): Promise<void> {
  await fs.mkdir(dirname(path), { recursive: true });
  await fs.writeFile(path, content);
}

/**
 * Delete a file
 */
export async function deleteFile(path: string): Promise<void> {
  await fs.unlink(path);
}

/**
 * List files in a directory
 */
export async function listFiles(directory: string, recursive: boolean = false): Promise<string[]> {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  
  for (const entry of entries) {
    const fullPath = join(directory, entry.name);
    if (entry.isFile()) {
      files.push(fullPath);
    } else if (entry.isDirectory() && recursive) {
      const subFiles = await listFiles(fullPath, recursive);
      files.push(...subFiles);
    }
  }
  
  return files;
}

/**
 * Get file information
 */
export async function getFileInfo(path: string): Promise<FileInfo> {
  const stats = await fs.stat(path);
  const buffer = await fs.readFile(path);
  
  return {
    path,
    filename: basename(path),
    extension: extname(path).replace('.', ''),
    directory: dirname(path),
    size: stats.size,
    contentType: getContentType(path),
    hash: computeFileHash(buffer)
  };
}

/**
 * Compute hash of file content
 */
export function computeFileHash(content: Buffer | string): string {
  const buffer = typeof content === 'string' ? Buffer.from(content) : content;
  return createHash('sha256').update(buffer).digest('hex');
}

/**
 * Get content type based on file extension
 */
export function getContentType(path: string): string {
  const extension = extname(path).toLowerCase().replace('.', '');
  
  const contentTypes: Record<string, string> = {
    html: 'text/html',
    htm: 'text/html',
    css: 'text/css',
    js: 'application/javascript',
    json: 'application/json',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    svg: 'image/svg+xml',
    webp: 'image/webp',
    ico: 'image/x-icon',
    txt: 'text/plain',
    xml: 'application/xml',
    pdf: 'application/pdf',
    wasm: 'application/wasm'
  };
  
  return contentTypes[extension] || 'application/octet-stream';
}

/**
 * Check if a path is a text file
 */
export function isTextFile(path: string): boolean {
  const textExtensions = ['.html', '.htm', '.css', '.js', '.json', '.txt', '.xml', '.svg', '.md'];
  const extension = extname(path).toLowerCase();
  return textExtensions.includes(extension);
}

/**
 * Check if a path is an image file
 */
export function isImageFile(path: string): boolean {
  const imageExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.ico'];
  const extension = extname(path).toLowerCase();
  return imageExtensions.includes(extension);
}

/**
 * Get file extension without dot
 */
export function getExtension(path: string): string {
  return extname(path).replace('.', '').toLowerCase();
}

/**
 * Create a readable stream from a buffer
 */
export function bufferToStream(buffer: Buffer): Readable {
  const stream = new Readable();
  stream.push(buffer);
  stream.push(null);
  return stream;
}

/**
 * Stream file content and compute hash
 */
export async function streamFileHash(path: string): Promise<string> {
  const hash = createHash('sha256');
  const stream = (await import('node:fs')).createReadStream(path);
  
  return new Promise((resolve, reject) => {
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}
