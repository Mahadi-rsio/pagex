-- Add `status` column to idempotency_keys.
--
-- The new column encodes three terminal/non-terminal states:
--   'in_progress' (default) — operation reserved but still running
--   'completed'             — operation finished; resource_id points to the created resource
--   'failed'                — terminal failure; key is retained to block unsafe re-use
--
-- Existing rows get the default value 'in_progress'. Rows that already have a
-- non-NULL resource_id are migrated to 'completed' in the same transaction.
--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD COLUMN "status" text NOT NULL DEFAULT 'in_progress';
--> statement-breakpoint
UPDATE "idempotency_keys" SET "status" = 'completed' WHERE "resource_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX "idx_idempotency_keys_status" ON "idempotency_keys" USING btree ("status");
