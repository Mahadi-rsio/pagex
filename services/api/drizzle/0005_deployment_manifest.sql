ALTER TABLE "deployments" ADD COLUMN "manifest_key" text;--> statement-breakpoint
ALTER TABLE "deployments" ADD COLUMN "manifest_version" integer;--> statement-breakpoint
ALTER TABLE "deployments" ADD COLUMN "manifest_size" integer;--> statement-breakpoint
ALTER TABLE "deployments" ADD COLUMN "manifest_hash" text;--> statement-breakpoint
ALTER TABLE "site_daily_stats" ADD CONSTRAINT "site_daily_stats_site_id_date_uid" UNIQUE("site_id","date");