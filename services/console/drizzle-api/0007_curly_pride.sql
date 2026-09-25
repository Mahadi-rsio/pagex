CREATE TABLE "idempotency_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"page_id" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" uuid NOT NULL,
	"request_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "idempotency_keys_tenant_page_key_uid" UNIQUE("tenant_id","page_id","idempotency_key")
);
--> statement-breakpoint
ALTER TABLE "deployments" DROP CONSTRAINT "deployments_build_id_builds_id_fk";
--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_idempotency_keys_expires" ON "idempotency_keys" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "idx_idempotency_keys_tenant_page" ON "idempotency_keys" USING btree ("tenant_id","page_id");--> statement-breakpoint
CREATE INDEX "idx_idempotency_keys_resource" ON "idempotency_keys" USING btree ("resource_type","resource_id");--> statement-breakpoint
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_build_id_builds_id_fk" FOREIGN KEY ("build_id") REFERENCES "public"."builds"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_deployments_build_id" ON "deployments" USING btree ("build_id");--> statement-breakpoint
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_page_id_version_uid" UNIQUE("page_id","version");
--> statement-breakpoint
-- CHECK constraint for builds.status
ALTER TABLE "builds" ADD CONSTRAINT "builds_status_check" CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled'));
--> statement-breakpoint
-- CHECK constraint for deployments.source
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_source_check" CHECK (source IN ('build', 'upload'));
--> statement-breakpoint
-- CHECK constraint: active deployments must have a finalized manifest
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_active_requires_manifest" CHECK (NOT is_active OR (manifest_key IS NOT NULL AND manifest_hash IS NOT NULL AND manifest_version IS NOT NULL AND manifest_size IS NOT NULL));
--> statement-breakpoint
-- CHECK constraint for idempotency_keys.resource_type
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_resource_type_check" CHECK (resource_type IN ('deployment', 'build'));