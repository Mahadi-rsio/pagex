ALTER TABLE "builds" ADD COLUMN "site_id" uuid;--> statement-breakpoint
ALTER TABLE "builds" ADD COLUMN "stage" text;--> statement-breakpoint
ALTER TABLE "builds" ADD COLUMN "branch" text DEFAULT 'main' NOT NULL;--> statement-breakpoint
ALTER TABLE "builds" ADD COLUMN "commit_sha" text;--> statement-breakpoint
ALTER TABLE "builds" ADD COLUMN "commit_message" text;--> statement-breakpoint
ALTER TABLE "builds" ADD COLUMN "requested_by" text;--> statement-breakpoint
ALTER TABLE "builds" ADD COLUMN "attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "builds" ADD COLUMN "max_attempts" integer DEFAULT 2 NOT NULL;--> statement-breakpoint
ALTER TABLE "builds" ADD COLUMN "log" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "builds" ADD COLUMN "log_bytes" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "builds" ADD COLUMN "log_truncated" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "builds" ADD COLUMN "deployment_id" uuid;--> statement-breakpoint
ALTER TABLE "builds" ADD COLUMN "token_hash" text;--> statement-breakpoint
ALTER TABLE "builds" ADD COLUMN "token_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "builds" ADD COLUMN "worker_id" text;--> statement-breakpoint
ALTER TABLE "builds" ADD COLUMN "lease_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "builds" ADD COLUMN "started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "builds" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "builds" ADD CONSTRAINT "builds_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_builds_page_created" ON "builds" USING btree ("page_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_builds_status_created" ON "builds" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "idx_builds_lease" ON "builds" USING btree ("status","lease_expires_at");