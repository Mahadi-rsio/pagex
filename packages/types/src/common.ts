// Common types and utilities

export type Maybe<T> = T | null | undefined;
export type Either<A, B> = A | B;
export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

export interface Config {
  db: DatabaseConfig;
  redis: RedisConfig;
  storage: StorageConfig;
  baseDomain: string;
  environment: 'development' | 'staging' | 'production';
  debug: boolean;
}

export interface EnvironmentVariables {
  [key: string]: string | undefined;
}

export interface Logger {
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
  debug(message: string, meta?: Record<string, unknown>): void;
}

export interface Metrics {
  increment(key: string, value?: number): void;
  decrement(key: string, value?: number): void;
  gauge(key: string, value: number): void;
  histogram(key: string, value: number): void;
  timing(key: string, duration: number): void;
}

// File types
export interface FileInfo {
  path: string;
  size: number;
  contentType: string;
  hash: string;
  lastModified: string;
}

export interface UploadResult {
  success: boolean;
  file: FileInfo;
  error?: string;
}

// Validation types
export interface ValidationError {
  field: string;
  message: string;
  code: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

// Cache types
export interface CacheEntry<T> {
  key: string;
  value: T;
  ttl: number;
  createdAt: number;
}

export interface CacheOptions {
  ttl?: number;
  prefix?: string;
}
