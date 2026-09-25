ALTER TABLE "deployments" ADD COLUMN "status" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_deployments_status" ON "deployments" USING btree ("status");