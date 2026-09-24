CREATE TABLE "usage_ingest_dedup" (
	"ingest_id" text PRIMARY KEY NOT NULL,
	"applied_at" timestamp with time zone DEFAULT now() NOT NULL
);
