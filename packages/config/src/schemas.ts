// Configuration schemas for validation

import { z } from 'zod';


// Database configuration schema
export const DatabaseConfigSchema = z.object({
  host: z.string().min(1),
  port: z.number().int().positive().default(5432),
  user: z.string().min(1),
  password: z.string().min(1),
  database: z.string().min(1),
  ssl: z.boolean().default(false),
});

export type DatabaseConfig = z.infer<typeof DatabaseConfigSchema>;

// Redis configuration schema
export const RedisConfigSchema = z.object({
  url: z.string().url().optional(),
  host: z.string().min(1).optional(),
  port: z.number().int().positive().default(6379),
  password: z.string().optional(),
  db: z.number().int().nonnegative().default(0),
});

export type RedisConfig = z.infer<typeof RedisConfigSchema>;

// Storage configuration schema
export const StorageConfigSchema = z.object({
  endpoint: z.string().min(1),
  port: z.number().int().positive().default(9000),
  useSSL: z.boolean().default(false),
  accessKey: z.string().min(1),
  secretKey: z.string().min(1),
  bucket: z.string().min(1),
});

export type StorageConfig = z.infer<typeof StorageConfigSchema>;

// Full application configuration schema
export const AppConfigSchema = z.object({
  db: DatabaseConfigSchema,
  redis: RedisConfigSchema,
  storage: StorageConfigSchema,
  baseDomain: z.string().min(1).default('localhost'),
  environment: z.enum(['development', 'staging', 'production']).default('development'),
  debug: z.boolean().default(false),
  
  // API settings
  api: z.object({
    port: z.number().int().positive().default(3000),
    rateLimit: z.object({
      window: z.number().int().positive().default(15 * 60 * 1000), // 15 minutes
      max: z.number().int().positive().default(100),
    }).default({}),
    timeout: z.number().int().positive().default(5 * 60 * 1000), // 5 minutes
  }).default({}),
  
  // Build settings
  build: z.object({
    timeout: z.number().int().positive().default(30 * 60 * 1000), // 30 minutes
    memoryLimit: z.string().default('1g'),
    diskLimit: z.string().default('10g'),
    workspace: z.string().default('/tmp/cloudisy-builds'),
  }).default({}),
  
  // Cache settings
  cache: z.object({
    ttl: z.number().int().positive().default(5 * 60), // 5 minutes
    size: z.number().int().positive().default(1000),
    maxSize: z.string().default('5MB'),
  }).default({}),
  
  // Deployment settings
  deployment: z.object({
    retention: z.number().int().nonnegative().default(10),
    blobRetentionDays: z.number().int().positive().default(30),
    maxFileSize: z.number().int().positive().default(10 * 1024 * 1024), // 10MB
    maxFilesPerDeploy: z.number().int().positive().default(100),
  }).default({}),
});

export type AppConfig = z.infer<typeof AppConfigSchema>;

// Validate and create configuration
export function createConfig(input: Partial<AppConfig>): AppConfig {
  return AppConfigSchema.parse(input);
}

// Create configuration from environment variables
export function createConfigFromEnv(): AppConfig {
  return createConfig({
    db: {
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432', 10),
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || 'postgres',
      database: process.env.DB_NAME || 'pagex',
      ssl: process.env.DB_SSL === 'true',
    },
    redis: {
      url: process.env.REDIS_URL,
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379', 10),
      password: process.env.REDIS_PASSWORD,
      db: parseInt(process.env.REDIS_DB || '0', 10),
    },
    storage: {
      endpoint: process.env.MINIO_ENDPOINT || 'localhost',
      port: parseInt(process.env.MINIO_PORT || '9000', 10),
      useSSL: process.env.MINIO_USE_SSL === 'true',
      accessKey: process.env.S3_ACCESS_KEY || '',
      secretKey: process.env.S3_SECRET_KEY || '',
      bucket: process.env.MINIO_BUCKET || 'pagex-blobs',
    },
    baseDomain: process.env.BASE_DOMAIN || 'localhost',
    environment: (process.env.NODE_ENV as 'development' | 'staging' | 'production') || 'development',
    debug: process.env.DEBUG === 'true',
  });
}

// Helper to parse environment variables safely
function parseEnvNumber(value: string | undefined, defaultValue: number): number {
  if (value === undefined) return defaultValue;
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? defaultValue : parsed;
}

function parseEnvBoolean(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined) return defaultValue;
  return value.toLowerCase() === 'true';
}
