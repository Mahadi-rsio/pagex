CREATE TABLE "bandwidth_usage_hourly" (
	"tenant_id" text NOT NULL,
	"site_id" uuid NOT NULL,
	"bucket" timestamp with time zone NOT NULL,
	"bytes" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bandwidth_usage_hourly_pk" PRIMARY KEY("tenant_id","site_id","bucket")
);
--> statement-breakpoint
CREATE TABLE "blob_tree_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deployment_id" uuid NOT NULL,
	"path" text NOT NULL,
	"blob_hash" text NOT NULL,
	CONSTRAINT "blob_tree_entries_deployment_path_uid" UNIQUE("deployment_id","path")
);
--> statement-breakpoint
CREATE TABLE "blobs" (
	"hash" text PRIMARY KEY NOT NULL,
	"size" integer NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "build_failures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"original_job_id" text NOT NULL,
	"queue_name" text NOT NULL,
	"tenant_id" text NOT NULL,
	"page_id" uuid NOT NULL,
	"build_id" uuid,
	"deployment_id" uuid,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error_type" text NOT NULL,
	"error_message" text NOT NULL,
	"failed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "builds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"page_id" uuid NOT NULL,
	"tenant_id" text NOT NULL,
	"job_id" text,
	"status" text DEFAULT 'queued' NOT NULL,
	"repo_url" text NOT NULL,
	"git_provider" text NOT NULL,
	"framework" text NOT NULL,
	"build_command" text DEFAULT 'pnpm build' NOT NULL,
	"output_dir" text,
	"error" text,
	"triggered_by" text DEFAULT 'cli' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "deployments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"page_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"tenant_id" text NOT NULL,
	"build_id" uuid,
	"version" integer NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"source" text NOT NULL,
	"file_count" integer NOT NULL,
	"files_deployed" integer,
	"files_reused" integer,
	"manifest_key" text,
	"manifest_version" integer,
	"manifest_size" integer,
	"manifest_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deployments_page_id_version_uid" UNIQUE("page_id","version")
);
--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"page_id" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"resource_type" text NOT NULL,
	"status" text DEFAULT 'in_progress' NOT NULL,
	"resource_id" uuid,
	"request_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "idempotency_keys_tenant_page_key_uid" UNIQUE("tenant_id","page_id","idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "pages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"tenant_id" text NOT NULL,
	"tenant_name" text NOT NULL,
	"plan" text DEFAULT 'free' NOT NULL,
	"domain" text NOT NULL,
	"project_name" text NOT NULL,
	"request" bigint DEFAULT 0 NOT NULL,
	"request_limit" bigint DEFAULT 100000 NOT NULL,
	"bandwidth_usage" bigint DEFAULT 0 NOT NULL,
	"bandwidth_limit" bigint DEFAULT 2147483648 NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_metrics_hourly" (
	"site_id" uuid NOT NULL,
	"bucket" timestamp with time zone NOT NULL,
	"requests" bigint DEFAULT 0 NOT NULL,
	"status_2xx" bigint DEFAULT 0 NOT NULL,
	"status_3xx" bigint DEFAULT 0 NOT NULL,
	"status_4xx" bigint DEFAULT 0 NOT NULL,
	"status_5xx" bigint DEFAULT 0 NOT NULL,
	"bytes" bigint DEFAULT 0 NOT NULL,
	"cache_hits" bigint DEFAULT 0 NOT NULL,
	"cache_misses" bigint DEFAULT 0 NOT NULL,
	"latency_sum_ms" bigint DEFAULT 0 NOT NULL,
	"latency_le_50" bigint DEFAULT 0 NOT NULL,
	"latency_le_100" bigint DEFAULT 0 NOT NULL,
	"latency_le_250" bigint DEFAULT 0 NOT NULL,
	"latency_le_500" bigint DEFAULT 0 NOT NULL,
	"latency_le_1000" bigint DEFAULT 0 NOT NULL,
	"latency_le_2500" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "service_metrics_hourly_pk" PRIMARY KEY("site_id","bucket")
);
--> statement-breakpoint
CREATE TABLE "site_daily_stats" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"date" date NOT NULL,
	"requests" bigint DEFAULT 0 NOT NULL,
	"bandwidth" bigint DEFAULT 0 NOT NULL,
	"requests_2xx" bigint DEFAULT 0 NOT NULL,
	"requests_3xx" bigint DEFAULT 0 NOT NULL,
	"requests_4xx" bigint DEFAULT 0 NOT NULL,
	"requests_5xx" bigint DEFAULT 0 NOT NULL,
	"humans" bigint DEFAULT 0 NOT NULL,
	"bots" bigint DEFAULT 0 NOT NULL,
	"unique_ips" bigint DEFAULT 0 NOT NULL,
	"peak_hour" text,
	"peak_hour_requests" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "site_daily_stats_site_id_date_uid" UNIQUE("site_id","date")
);
--> statement-breakpoint
CREATE TABLE "sites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subdomain" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "sites_subdomain_unique" UNIQUE("subdomain")
);
--> statement-breakpoint
CREATE TABLE "usage_ingest_dedup" (
	"ingest_id" text PRIMARY KEY NOT NULL,
	"applied_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bandwidth_usage_hourly" ADD CONSTRAINT "bandwidth_usage_hourly_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blob_tree_entries" ADD CONSTRAINT "blob_tree_entries_deployment_id_deployments_id_fk" FOREIGN KEY ("deployment_id") REFERENCES "public"."deployments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blob_tree_entries" ADD CONSTRAINT "blob_tree_entries_blob_hash_blobs_hash_fk" FOREIGN KEY ("blob_hash") REFERENCES "public"."blobs"("hash") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "build_failures" ADD CONSTRAINT "build_failures_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "build_failures" ADD CONSTRAINT "build_failures_build_id_builds_id_fk" FOREIGN KEY ("build_id") REFERENCES "public"."builds"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "build_failures" ADD CONSTRAINT "build_failures_deployment_id_deployments_id_fk" FOREIGN KEY ("deployment_id") REFERENCES "public"."deployments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "builds" ADD CONSTRAINT "builds_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_build_id_builds_id_fk" FOREIGN KEY ("build_id") REFERENCES "public"."builds"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pages" ADD CONSTRAINT "pages_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_metrics_hourly" ADD CONSTRAINT "service_metrics_hourly_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_daily_stats" ADD CONSTRAINT "site_daily_stats_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_bandwidth_usage_tenant_bucket" ON "bandwidth_usage_hourly" USING btree ("tenant_id","bucket");--> statement-breakpoint
CREATE INDEX "idx_bandwidth_usage_site_bucket" ON "bandwidth_usage_hourly" USING btree ("site_id","bucket");--> statement-breakpoint
CREATE INDEX "idx_blob_tree_entries_deployment" ON "blob_tree_entries" USING btree ("deployment_id");--> statement-breakpoint
CREATE INDEX "idx_build_failures_page_id" ON "build_failures" USING btree ("page_id");--> statement-breakpoint
CREATE INDEX "idx_build_failures_build_id" ON "build_failures" USING btree ("build_id");--> statement-breakpoint
CREATE INDEX "idx_build_failures_failed_at" ON "build_failures" USING btree ("failed_at");--> statement-breakpoint
CREATE INDEX "idx_builds_page_tenant_status" ON "builds" USING btree ("page_id","tenant_id","status");--> statement-breakpoint
CREATE INDEX "idx_deployments_page_active" ON "deployments" USING btree ("page_id","is_active");--> statement-breakpoint
CREATE INDEX "idx_deployments_page_tenant_version" ON "deployments" USING btree ("page_id","tenant_id","version");--> statement-breakpoint
CREATE INDEX "idx_deployments_page_tenant" ON "deployments" USING btree ("page_id","tenant_id");--> statement-breakpoint
CREATE INDEX "idx_deployments_build_id" ON "deployments" USING btree ("build_id");--> statement-breakpoint
CREATE INDEX "idx_deployments_status" ON "deployments" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "deployments_page_id_is_active_uid" ON "deployments" USING btree ("page_id") WHERE is_active = true;--> statement-breakpoint
CREATE UNIQUE INDEX "deployments_build_id_uid" ON "deployments" USING btree ("build_id") WHERE build_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_idempotency_keys_expires" ON "idempotency_keys" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "idx_idempotency_keys_tenant_page" ON "idempotency_keys" USING btree ("tenant_id","page_id");--> statement-breakpoint
CREATE INDEX "idx_idempotency_keys_resource" ON "idempotency_keys" USING btree ("resource_type","resource_id");--> statement-breakpoint
CREATE INDEX "idx_idempotency_keys_status" ON "idempotency_keys" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_pages_tenant" ON "pages" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_pages_domain" ON "pages" USING btree ("domain");--> statement-breakpoint
CREATE INDEX "idx_pages_project_tenant" ON "pages" USING btree ("project_name","tenant_id");--> statement-breakpoint
CREATE INDEX "idx_service_metrics_site_bucket" ON "service_metrics_hourly" USING btree ("site_id","bucket");--> statement-breakpoint
CREATE INDEX "idx_service_metrics_bucket" ON "service_metrics_hourly" USING btree ("bucket");--> statement-breakpoint
CREATE INDEX "idx_site_daily_stats_site_date" ON "site_daily_stats" USING btree ("site_id","date");--> statement-breakpoint
CREATE INDEX "idx_sites_subdomain" ON "sites" USING btree ("subdomain");