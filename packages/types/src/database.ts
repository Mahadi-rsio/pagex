// Database schema types shared between services

export interface DatabaseConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  ssl?: boolean;
}

export interface RedisConfig {
  url: string;
  host?: string;
  port?: number;
  password?: string;
  db?: number;
}

export interface StorageConfig {
  endpoint: string;
  port: number;
  useSSL: boolean;
  accessKey: string;
  secretKey: string;
  bucket: string;
}

// Table interfaces (mirror database schemas)
export interface SiteRow {
  id: string;
  subdomain: string;
  active: boolean;
  created_at: string;
}

export interface PageRow {
  id: string;
  site_id: string;
  name: string;
  domain?: string;
  custom_domain?: string;
  created_at: string;
  updated_at: string;
}

export interface DeploymentRow {
  id: string;
  site_id: string;
  is_active: boolean;
  created_at: string;
  files_deployed: number;
  files_reused: number;
}

export interface BlobRow {
  hash: string;
  size: number;
  content_type: string;
  created_at: string;
}

export interface BlobTreeEntryRow {
  id: string;
  deployment_id: string;
  path: string;
  blob_hash: string;
}

export interface BuildRow {
  id: string;
  page_id: string;
  status: string;
  repository_url?: string;
  branch?: string;
  commit_hash?: string;
  logs?: string;
  created_at: string;
  completed_at?: string;
}

export interface SiteDailyStatsRow {
  id: string;
  site_id: string;
  date: string;
  requests: number;
  bandwidth: number;
  created_at: string;
}
