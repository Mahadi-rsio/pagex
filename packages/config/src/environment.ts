// Environment configuration utilities

import { z } from 'zod';

// Environment schema for all services
export const EnvironmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'staging', 'production']).default('development'),
  
  // Database
  DATABASE_URL: z.string().optional(),
  DB: z.string().optional(),
  DRIZZLE_CONNECTION: z.string().optional(),
  DIRECT_DB: z.string().optional(),
  
  // Redis
  REDIS_URL: z.string().default('redis://localhost:6379'),
  
  // Storage
  MINIO_ENDPOINT: z.string().optional(),
  MINIO_PORT: z.string().default('9000'),
  MINIO_ENDPOINT_URL: z.string().optional(),
  MINIO_USE_SSL: z.string().default('false'),
  S3_ACCESS_KEY: z.string().optional(),
  S3_SECRET_KEY: z.string().optional(),
  MINIO_BUCKET: z.string().optional(),
  
  // Application
  BASE_DOMAIN: z.string().default('localhost'),
  PUBLIC_URL: z.string().default('http://localhost:3080'),
  
  // Authentication
  AUTH_JWKS_URL: z.string().optional(),
  BETTER_AUTH_URL: z.string().optional(),
  BETTER_AUTH_TRUSTED_ORIGINS: z.string().optional(),
  BETTER_AUTH_SECRET: z.string().optional(),
  
  // Docker
  IN_DOCKER_COMPOSE: z.string().default('0'),
  
  // Service specific
  NEXT_WEB_DATABASE_URL: z.string().optional(),
  ENABLE_EMAIL_PASSWORD: z.string().default('true'),
  NEXT_PUBLIC_ENABLE_EMAIL_PASSWORD: z.string().default('true'),
});

export type Environment = z.infer<typeof EnvironmentSchema>;

// API service specific environment
export const ApiEnvironmentSchema = EnvironmentSchema.extend({
  PORT: z.string().default('3000'),
  
  // Queue
  BULLMQ_REDIS_URL: z.string().optional(),
  
  // Build
  BUILD_ENV_IMAGE: z.string().default('pagex-build-env:latest'),
  BUILD_WORKSPACE: z.string().default('/tmp/cloudisy-builds'),
});

export type ApiEnvironment = z.infer<typeof ApiEnvironmentSchema>;

// Blob server specific environment
export const BlobServerEnvironmentSchema = EnvironmentSchema.extend({
  CADDY_PORT: z.string().default('80'),
  CADDY_HTTPS_PORT: z.string().default('443'),
  CADDY_CONSOLE_PORT: z.string().default('3080'),
  
  // Cache
  CACHE_TTL: z.string().default('10m'),
  CACHE_SIZE: z.string().default('2000'),
  MAX_CACHE_SIZE: z.string().default('5MB'),
  
  // S3 Redirect
  REDIRECT_TO_S3: z.string().default('false'),
  PRESIGN_REDIRECT: z.string().default('false'),
  PRESIGN_LIFETIME: z.string().default('15m'),
});

export type BlobServerEnvironment = z.infer<typeof BlobServerEnvironmentSchema>;

// Console specific environment
export const ConsoleEnvironmentSchema = EnvironmentSchema.extend({
  NEXT_PORT: z.string().default('3000'),
  CONSOLE_PORT: z.string().default('3080'),
  
  // OAuth
  GITHUB_CLIENT_ID: z.string().optional(),
  GITHUB_CLIENT_SECRET: z.string().optional(),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  
  // Email
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.string().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SENDER: z.string().optional(),
  
  // SMS
  BREVO_API_KEY: z.string().optional(),
  SMS_TOKEN: z.string().optional(),
});

export type ConsoleEnvironment = z.infer<typeof ConsoleEnvironmentSchema>;

// Utility functions
export function parseBoolean(value: string | undefined, defaultValue: boolean = false): boolean {
  if (value === undefined) return defaultValue;
  return value.toLowerCase() === 'true';
}

export function parseNumber(value: string | undefined, defaultValue: number = 0): number {
  if (value === undefined) return defaultValue;
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? defaultValue : parsed;
}

export function parseStringArray(value: string | undefined, defaultValue: string[] = []): string[] {
  if (value === undefined) return defaultValue;
  return value.split(',').map(s => s.trim()).filter(s => s.length > 0);
}

// Validate environment
export function validateEnvironment<T extends z.ZodTypeAny>(
  schema: T,
  env: Record<string, string | undefined> = process.env
): z.infer<T> {
  try {
    return schema.parse(env);
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.error('Environment validation failed:');
      error.errors.forEach(err => {
        console.error(`  - ${err.path.join('.')}: ${err.message}`);
      });
    }
    throw error;
  }
}

// Get environment for a specific service
export function getApiEnvironment(): ApiEnvironment {
  return validateEnvironment(ApiEnvironmentSchema);
}

export function getBlobServerEnvironment(): BlobServerEnvironment {
  return validateEnvironment(BlobServerEnvironmentSchema);
}

export function getConsoleEnvironment(): ConsoleEnvironment {
  return validateEnvironment(ConsoleEnvironmentSchema);
}

// Check if running in Docker Compose
export function isInDockerCompose(): boolean {
  return process.env.IN_DOCKER_COMPOSE === '1';
}

// Get Redis URL for a specific database
export function getRedisUrl(db: number = 0): string {
  const baseUrl = process.env.REDIS_URL || 'redis://localhost:6379';
  return db > 0 ? `${baseUrl}/${db}` : baseUrl;
}

// Get database URL
export function getDatabaseUrl(): string {
  return process.env.DATABASE_URL || process.env.DB || '';
}

// Get MinIO endpoint URL
export function getMinioEndpointUrl(): string {
  const protocol = process.env.MINIO_USE_SSL === 'true' ? 'https' : 'http';
  const host = process.env.MINIO_ENDPOINT || 'localhost';
  const port = process.env.MINIO_PORT || '9000';
  return `${protocol}://${host}:${port}`;
}
