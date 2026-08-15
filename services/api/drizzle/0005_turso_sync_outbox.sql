CREATE TABLE "blob_tree_sync_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"deployment_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"event_type" text DEFAULT 'SYNC_DEPLOYMENT' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_attempt_at" timestamp with time zone,
	"processed_at" timestamp with time zone,
	"last_error" text,
	CONSTRAINT "blob_tree_sync_outbox_deployment_id_unique" UNIQUE("deployment_id")
);
--> statement-breakpoint
ALTER TABLE "blob_tree_sync_outbox" ADD CONSTRAINT "blob_tree_sync_outbox_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blob_tree_sync_outbox" ADD CONSTRAINT "blob_tree_sync_outbox_deployment_id_deployments_id_fk" FOREIGN KEY ("deployment_id") REFERENCES "public"."deployments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_blob_tree_sync_outbox_status" ON "blob_tree_sync_outbox" USING btree ("status","created_at");