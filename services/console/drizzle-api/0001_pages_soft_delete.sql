ALTER TABLE "pages" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "idx_pages_site" ON "pages" USING btree ("site_id");