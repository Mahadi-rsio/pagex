// Validation utilities

import type { ValidationError, ValidationResult } from '@pagex/types';

/**
 * Validate that a value is not empty
 */
export function isNotEmpty(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return true;
}

/**
 * Validate that a value is a valid UUID
 */
export function isValidUUID(value: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(value);
}

/**
 * Validate that a value is a valid subdomain
 */
export function isValidSubdomain(value: string): boolean {
  const subdomainRegex = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/i;
  return subdomainRegex.test(value);
}

/**
 * Validate that a value is a valid email
 */
export function isValidEmail(value: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(value);
}

/**
 * Validate that a value is a valid URL
 */
export function isValidUrl(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Validate that a value is within a range
 */
export function isInRange(value: number, min: number, max: number): boolean {
  return value >= min && value <= max;
}

/**
 * Validate that a string has a maximum length
 */
export function hasMaxLength(value: string, max: number): boolean {
  return value.length <= max;
}

/**
 * Validate that a string has a minimum length
 */
export function hasMinLength(value: string, min: number): boolean {
  return value.length >= min;
}

/**
 * Create a validation result
 */
export function createValidationResult(
  valid: boolean,
  errors: ValidationError[] = []
): ValidationResult {
  return { valid, errors };
}

/**
 * Validate required fields
 */
export function validateRequired<T extends Record<string, unknown>>(
  obj: T,
  requiredFields: (keyof T)[]
): ValidationResult {
  const errors: ValidationError[] = [];
  
  for (const field of requiredFields) {
    const value = obj[field];
    if (!isNotEmpty(value)) {
      errors.push({
        field: field as string,
        message: `${field as string} is required`,
        code: 'REQUIRED_FIELD'
      });
    }
  }
  
  return createValidationResult(errors.length === 0, errors);
}

/**
 * Validate object structure against a schema
 */
export function validateSchema<T>(
  obj: unknown,
  schema: Record<keyof T, (value: unknown) => boolean>
): ValidationResult {
  const errors: ValidationError[] = [];
  
  if (typeof obj !== 'object' || obj === null) {
    return createValidationResult(false, [{
      field: 'root',
      message: 'Expected an object',
      code: 'INVALID_TYPE'
    }]);
  }
  
  for (const [key, validator] of Object.entries(schema)) {
    const value = (obj as Record<string, unknown>)[key];
    const v = validator as (value: unknown) => boolean;
    if (!v(value)) {
      errors.push({
        field: key,
        message: `${key} is invalid`,
        code: 'INVALID_VALUE'
      });
    }
  }
  
  return createValidationResult(errors.length === 0, errors);
}
