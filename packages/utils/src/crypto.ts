// Cryptographic utilities

import { createHash, createHmac, randomBytes } from 'node:crypto';

/**
 * Generate a cryptographically secure random string
 */
export function generateRandomString(length: number = 32): string {
  return randomBytes(length).toString('hex');
}

/**
 * Generate a UUID v4
 */
export function generateUUID(): string {
  return randomBytes(16).toString('hex');
}

/**
 * Create SHA256 hash of a string
 */
export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/**
 * Create SHA1 hash of a string
 */
export function sha1(value: string): string {
  return createHash('sha1').update(value).digest('hex');
}

/**
 * Create MD5 hash of a string
 */
export function md5(value: string): string {
  return createHash('md5').update(value).digest('hex');
}

/**
 * Create HMAC signature
 */
export function hmac(
  value: string,
  secret: string,
  algorithm: string = 'sha256'
): string {
  return createHmac(algorithm, secret).update(value).digest('hex');
}

/**
 * Verify HMAC signature
 */
export function verifyHmac(
  value: string,
  secret: string,
  signature: string,
  algorithm: string = 'sha256'
): boolean {
  const expectedSignature = hmac(value, secret, algorithm);
  return timingSafeEqual(signature, expectedSignature);
}

/**
 * Timing-safe string comparison
 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  
  return result === 0;
}

/**
 * Generate a secure token
 */
export function generateToken(length: number = 64): string {
  return generateRandomString(length);
}

/**
 * Hash password with salt
 */
export function hashPassword(password: string, salt?: string): { hash: string; salt: string } {
  const generatedSalt = salt || generateRandomString(16);
  const hash = sha256(password + generatedSalt);
  return { hash, salt: generatedSalt };
}

/**
 * Verify password against hash
 */
export function verifyPassword(password: string, hash: string, salt: string): boolean {
  const computedHash = sha256(password + salt);
  return timingSafeEqual(computedHash, hash);
}

/**
 * Generate a short hash for URLs
 */
export function generateShortHash(value: string, length: number = 8): string {
  const fullHash = sha256(value);
  return fullHash.substring(0, length);
}

/**
 * Create a content hash for cache keys
 */
export function contentHash(data: string | Buffer): string {
  const buffer = typeof data === 'string' ? Buffer.from(data) : data;
  return createHash('sha256').update(buffer).digest('hex');
}
