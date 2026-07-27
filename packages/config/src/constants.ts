// Shared constants for PageX services

// Deployment constants
export const DEPLOYMENT_RETENTION = 10; // Keep 10 inactive deployments
export const BLOB_RETENTION_DAYS = 30; // Keep orphaned blobs for 30 days
export const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
export const MAX_FILES_PER_DEPLOY = 100;
export const DEPLOY_TOKEN_TTL = 10 * 60; // 10 minutes in seconds

export const DEPLOYMENT_RETENTION_KEY = 'DEPLOYMENT_RETENTION';
export const BLOB_RETENTION_DAYS_KEY = 'BLOB_RETENTION_DAYS';
export const MAX_FILE_SIZE_KEY = 'MAX_FILE_SIZE';
export const MAX_FILES_PER_DEPLOY_KEY = 'MAX_FILES_PER_DEPLOY';

// Cache constants
export const CACHE_TTL_DEFAULT = 5 * 60; // 5 minutes
export const CACHE_TTL_LONG = 24 * 60 * 60; // 24 hours
export const CACHE_SIZE_DEFAULT = 1000;
export const MAX_CACHE_SIZE = 5 * 1024 * 1024; // 5MB

// Redis constants
export const REDIS_DB_SITE = 0;
export const REDIS_DB_QUEUE = 2;
export const REDIS_DB_CACHE = 3;

// Database constants
export const DATABASE_POOL_SIZE = 10;
export const DATABASE_MAX_CONNECTIONS = 100;
export const DATABASE_IDLE_TIMEOUT = 30000; // 30 seconds

// Storage constants
export const MINIO_BUCKET_DEFAULT = 'pagex-blobs';
export const MINIO_BLOBS_PREFIX = 'blobs';
export const MINIO_TENANT_PREFIX = 'tenant';

// API constants
export const API_RATE_LIMIT_WINDOW = 15 * 60 * 1000; // 15 minutes
export const API_RATE_LIMIT_MAX = 100; // 100 requests per window
export const API_TIMEOUT = 5 * 60 * 1000; // 5 minutes
export const API_PAGINATION_LIMIT = 50;

// Build constants
export const BUILD_TIMEOUT = 30 * 60 * 1000; // 30 minutes
export const BUILD_MEMORY_LIMIT = '1g'; // 1GB RAM
export const BUILD_DISK_LIMIT = '10g'; // 10GB disk

// Authentication constants
export const JWT_EXPIRY = '24h';
export const JWT_REFRESH_EXPIRY = '7d';
export const SESSION_TTL = 24 * 60 * 60; // 24 hours in seconds

// Service names
export const SERVICE_API = 'api';
export const SERVICE_BLOB_SERVER = 'blob-server';
export const SERVICE_CONSOLE = 'console';

// Environment constants
export const ENV_DEVELOPMENT = 'development';
export const ENV_STAGING = 'staging';
export const ENV_PRODUCTION = 'production';

// HTTP constants
export const HTTP_PORT_API = 3000;
export const HTTP_PORT_BLOB_SERVER = 80;
export const HTTP_PORT_BLOB_SERVER_HTTPS = 443;
export const HTTP_PORT_CONSOLE = 3080;

// Docker constants
export const DOCKER_NETWORK = 'pagex_network';
export const DOCKER_VOLUME_PGDATA = 'pagex_pgdata';
export const DOCKER_VOLUME_CADDY_DATA = 'pagex_caddy_data';
export const DOCKER_VOLUME_CADDY_CONFIG = 'pagex_caddy_config';

// Health check constants
export const HEALTH_CHECK_INTERVAL = 5000; // 5 seconds
export const HEALTH_CHECK_TIMEOUT = 3000; // 3 seconds
export const HEALTH_CHECK_RETRIES = 3;

// Analytics constants
export const ANALYTICS_FLUSH_INTERVAL = 60 * 1000; // 1 minute
export const ANALYTICS_BATCH_SIZE = 100;

// File type constants
export const ALLOWED_EXTENSIONS = [
  'html', 'htm', 'css', 'js', 'json', 'txt', 'xml', 'svg',
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'woff', 'woff2', 'ttf'
];

export const BLOCKED_EXTENSIONS = [
  'exe', 'dll', 'so', 'bat', 'cmd', 'sh', 'ps1', 'vbs',
  'php', 'py', 'rb', 'java', 'class', 'jar', 'war', 'ear',
  'zip', 'tar', 'gz', 'rar', '7z', 'iso',
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
  'db', 'sqlite', 'mdb', 'accdb',
  'log', 'tmp', 'temp', 'bak', 'backup'
];

// Content type constants
export const TEXT_CONTENT_TYPES = [
  'text/html', 'text/css', 'application/javascript', 'application/json',
  'text/plain', 'application/xml', 'image/svg+xml'
];

export const IMAGE_CONTENT_TYPES = [
  'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/x-icon', 'image/svg+xml'
];

export const BINARY_CONTENT_TYPES = [
  'application/octet-stream', 'application/pdf', 'application/zip',
  'font/woff', 'font/woff2', 'font/ttf'
];
