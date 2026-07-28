// String utilities

/**
 * Check if a string is null, undefined, or empty
 */
export function isEmpty(value: string | null | undefined): boolean {
  return value === null || value === undefined || value.trim().length === 0;
}


/**
 * Capitalize the first letter of a string
 */
export function capitalize(str: string): string {
  if (isEmpty(str)) return str;
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Convert string to lowercase
 */
export function toLowerCase(str: string): string {
  return str.toLowerCase();
}

/**
 * Convert string to uppercase
 */
export function toUpperCase(str: string): string {
  return str.toUpperCase();
}

/**
 * Trim whitespace from both ends
 */
export function trim(str: string): string {
  return str.trim();
}

/**
 * Trim whitespace from start
 */
export function trimStart(str: string): string {
  return str.trimStart();
}

/**
 * Trim whitespace from end
 */
export function trimEnd(str: string): string {
  return str.trimEnd();
}

/**
 * Replace all occurrences of a substring
 */
export function replaceAll(str: string, search: string, replace: string): string {
  return str.split(search).join(replace);
}

/**
 * Check if string contains substring
 */
export function contains(str: string, substring: string): boolean {
  return str.includes(substring);
}

/**
 * Check if string starts with prefix
 */
export function startsWith(str: string, prefix: string): boolean {
  return str.startsWith(prefix);
}

/**
 * Check if string ends with suffix
 */
export function endsWith(str: string, suffix: string): boolean {
  return str.endsWith(suffix);
}

/**
 * Split string by delimiter
 */
export function split(str: string, delimiter: string): string[] {
  return str.split(delimiter);
}

/**
 * Join array of strings with delimiter
 */
export function join(strings: string[], delimiter: string): string {
  return strings.join(delimiter);
}

/**
 * Get substring
 */
export function substring(str: string, start: number, end?: number): string {
  return end !== undefined ? str.substring(start, end) : str.substring(start);
}

/**
 * Get string length
 */
export function length(str: string): number {
  return str.length;
}

/**
 * Check if string matches a pattern
 */
export function matches(str: string, pattern: RegExp): boolean {
  return pattern.test(str);
}

/**
 * Escape special regex characters
 */
export function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Generate a slug from a string
 */
export function slugify(str: string): string {
  return str
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Truncate string to specified length
 */
export function truncate(str: string, length: number, suffix: string = '...'): string {
  if (str.length <= length) return str;
  return str.substring(0, length - suffix.length) + suffix;
}

/**
 * Pad string to specified length
 */
export function padStart(str: string, length: number, padChar: string = ' '): string {
  while (str.length < length) {
    str = padChar + str;
  }
  return str;
}

/**
 * Pad string to specified length at end
 */
export function padEnd(str: string, length: number, padChar: string = ' '): string {
  while (str.length < length) {
    str = str + padChar;
  }
  return str;
}

/**
 * Repeat string
 */
export function repeat(str: string, count: number): string {
  return str.repeat(count);
}

/**
 * Reverse string
 */
export function reverse(str: string): string {
  return str.split('').reverse().join('');
}

/**
 * Check if string is a valid URL
 */
export function isUrl(str: string): boolean {
  try {
    new URL(str);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if string is a valid email
 */
export function isEmail(str: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(str);
}

/**
 * Check if string is a valid UUID
 */
export function isUUID(str: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(str);
}

/**
 * Check if string is a valid subdomain
 */
export function isSubdomain(str: string): boolean {
  const subdomainRegex = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/i;
  return subdomainRegex.test(str);
}

/**
 * Convert camelCase to snake_case
 */
export function toSnakeCase(str: string): string {
  return str
    .replace(/([A-Z])/g, '_$1')
    .toLowerCase()
    .replace(/^_/, '')
    .replace(/_+/g, '_');
}

/**
 * Convert snake_case to camelCase
 */
export function toCamelCase(str: string): string {
  return str
    .replace(/_([a-z])/g, (_, letter) => letter.toUpperCase())
    .replace(/^[A-Z]/, (letter) => letter.toLowerCase());
}

/**
 * Convert to PascalCase
 */
export function toPascalCase(str: string): string {
  return str
    .replace(/_([a-z])/g, (_, letter) => letter.toUpperCase())
    .replace(/^[a-z]/, (letter) => letter.toUpperCase());
}

/**
 * Convert to kebab-case
 */
export function toKebabCase(str: string): string {
  return str
    .replace(/([A-Z])/g, '-$1')
    .toLowerCase()
    .replace(/^-/, '')
    .replace(/-+/g, '-');
}
