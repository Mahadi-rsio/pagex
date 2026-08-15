import { config as loadEnv } from 'dotenv'

// Load repo-root .env (services/api has none of its own).
loadEnv({ path: '../../.env' })

// Point every DB/Redis consumer at locally reachable test services.
process.env.IN_DOCKER_COMPOSE = '0'
process.env.DB = process.env.TEST_DB ?? 'postgresql://postgres:postgres@localhost:5432/pagex_test'
process.env.DRIZZLE_CONNECTION = process.env.DB

// MINIO_* must be present so modules that construct the MinIO client at import
// time (deploy.service → gc.service → minio.ts) do not throw. The client is
// lazy — no connection is attempted unless tests actually call it.
process.env.MINIO_ENDPOINT ??= 'localhost'
process.env.MINIO_PORT ??= '9000'
process.env.MINIO_USE_SSL ??= 'false'
process.env.S3_ACCESS_KEY ??= 'test'
process.env.S3_SECRET_KEY ??= 'test'
process.env.MINIO_BUCKET ??= 'pagex-test-blobs'