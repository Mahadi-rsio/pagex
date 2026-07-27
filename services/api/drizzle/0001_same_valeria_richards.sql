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
ALTER TABLE "builds" ADD CONSTRAINT "builds_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_builds_page_tenant_status" ON "builds" USING btree ("page_id","tenant_id","status");