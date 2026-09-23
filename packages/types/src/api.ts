// API contract types shared between services

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface ErrorResponse {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

// Authentication types
export interface User {
  id: string;
  email: string;
  name?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AuthToken {
  token: string;
  expiresAt: string;
  user: User;
}

// Site/Page types
export interface Site {
  id: string;
  subdomain: string;
  active: boolean;
  createdAt: string;
}

export interface Page {
  id: string;
  siteId: string;
  name: string;
  domain?: string;
  createdAt: string;
  updatedAt: string;
}

// Deployment types
export interface Deployment {
  id: string;
  siteId: string;
  isActive: boolean;
  createdAt: string;
  filesDeployed: number;
  filesReused: number;
}

export interface Blob {
  hash: string;
  size: number;
  contentType: string;
  createdAt: string;
}

// Build types
export interface Build {
  id: string;
  pageId: string;
  status: 'queued' | 'active' | 'completed' | 'failed';
  repositoryUrl?: string;
  branch?: string;
  commitHash?: string;
  logs?: string;
  createdAt: string;
  completedAt?: string;
}

// Analytics types
export interface SiteStats {
  siteId: string;
  requests: number;
  bandwidth: number;
  date: string;
}

// Usage & quota types — bandwidth-only billing. Requests are UNLIMITED on every
// plan and deliberately have no limit/quota field here.
export type PlanId = 'free' | 'paid';

export interface PlanQuota {
  id: PlanId;
  name: string;
  /** Monthly bandwidth allowance in bytes; `null` means unlimited. */
  bandwidthLimitBytes: number | null;
}

export interface BandwidthUsage {
  usedBytes: number;
  limitBytes: number | null;
  remainingBytes: number | null;
  percentage: number | null;
  unlimited: boolean;
  overQuota: boolean;
}

export interface UsagePeriod {
  start: string;
  end: string;
  key: string;
}

export interface UsageResponse {
  period: UsagePeriod;
  plan: PlanId;
  planName: string;
  bandwidth: BandwidthUsage;
}

export interface AccountQuota {
  plan: PlanId;
  planName: string;
  period: UsagePeriod;
  siteCount: number;
  bandwidth: BandwidthUsage;
}

// Operational metrics types (separate from billing usage)
export interface LatencySummary {
  averageMs: number | null;
  p50: number | null;
  p95: number | null;
  p99: number | null;
  samples: number;
}

export interface MetricsWindow {
  start: string;
  end: string;
}

export interface MetricsResponse {
  requests: number;
  bandwidthBytes: number;
  status: { '2xx': number; '3xx': number; '4xx': number; '5xx': number };
  cache: { hits: number; misses: number; hitRate: number | null };
  latency: LatencySummary;
  window: MetricsWindow;
}

