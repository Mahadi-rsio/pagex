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
ALTER TABLE "idempotency_keys" ALTER COLUMN "resource_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "build_failures" ADD CONSTRAINT "build_failures_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "build_failures" ADD CONSTRAINT "build_failures_build_id_builds_id_fk" FOREIGN KEY ("build_id") REFERENCES "public"."builds"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "build_failures" ADD CONSTRAINT "build_failures_deployment_id_deployments_id_fk" FOREIGN KEY ("deployment_id") REFERENCES "public"."deployments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_build_failures_page_id" ON "build_failures" USING btree ("page_id");--> statement-breakpoint
CREATE INDEX "idx_build_failures_build_id" ON "build_failures" USING btree ("build_id");--> statement-breakpoint
CREATE INDEX "idx_build_failures_failed_at" ON "build_failures" USING btree ("failed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "deployments_page_id_is_active_uid" ON "deployments" USING btree ("page_id") WHERE is_active = true;--> statement-breakpoint
CREATE UNIQUE INDEX "deployments_build_id_uid" ON "deployments" USING btree ("build_id") WHERE build_id IS NOT NULL;