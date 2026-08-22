-- Database Invariants Migration
-- This migration enforces database-level constraints and adds performance indexes

-- P0: Enforce only one active deployment per page at DB level
CREATE UNIQUE INDEX "deployments_page_id_is_active_uid" ON "deployments" ("page_id") WHERE "is_active" = true;--> statement-breakpoint

-- Add indexes for pages table hot queries
CREATE INDEX "idx_pages_tenant" ON "pages" ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_pages_domain" ON "pages" ("domain");--> statement-breakpoint
CREATE INDEX "idx_pages_project_tenant" ON "pages" ("project_name", "tenant_id");--> statement-breakpoint

-- Add indexes for deployments table hot queries
CREATE INDEX "idx_deployments_page_active" ON "deployments" ("page_id", "is_active");--> statement-breakpoint
CREATE INDEX "idx_deployments_page_tenant_version" ON "deployments" ("page_id", "tenant_id", "version");--> statement-breakpoint
CREATE INDEX "idx_deployments_page_tenant" ON "deployments" ("page_id", "tenant_id");