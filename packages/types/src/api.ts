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
