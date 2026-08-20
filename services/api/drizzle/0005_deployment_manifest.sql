ALTER TABLE "deployments" ADD COLUMN "manifest_key" text;--> statement-breakpoint
ALTER TABLE "deployments" ADD COLUMN "manifest_version" integer;--> statement-breakpoint
ALTER TABLE "deployments" ADD COLUMN "manifest_size" integer;--> statement-breakpoint
ALTER TABLE "deployments" ADD COLUMN "manifest_hash" text;
