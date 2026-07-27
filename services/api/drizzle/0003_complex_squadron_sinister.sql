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
ALTER TABLE "deployments" ALTER COLUMN "snapshot_prefix" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "deployments" ADD COLUMN "files_deployed" integer;--> statement-breakpoint
ALTER TABLE "deployments" ADD COLUMN "files_reused" integer;--> statement-breakpoint
ALTER TABLE "blob_tree_entries" ADD CONSTRAINT "blob_tree_entries_deployment_id_deployments_id_fk" FOREIGN KEY ("deployment_id") REFERENCES "public"."deployments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blob_tree_entries" ADD CONSTRAINT "blob_tree_entries_blob_hash_blobs_hash_fk" FOREIGN KEY ("blob_hash") REFERENCES "public"."blobs"("hash") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_blob_tree_entries_deployment" ON "blob_tree_entries" USING btree ("deployment_id");