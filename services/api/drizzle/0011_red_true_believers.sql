CREATE TABLE "bandwidth_usage_hourly" (
	"tenant_id" text NOT NULL,
	"site_id" uuid NOT NULL,
	"bucket" timestamp with time zone NOT NULL,
	"bytes" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bandwidth_usage_hourly_pk" PRIMARY KEY("tenant_id","site_id","bucket")
);
--> statement-breakpoint
CREATE TABLE "service_metrics_hourly" (
	"site_id" uuid NOT NULL,
	"bucket" timestamp with time zone NOT NULL,
	"requests" bigint DEFAULT 0 NOT NULL,
	"status_2xx" bigint DEFAULT 0 NOT NULL,
	"status_3xx" bigint DEFAULT 0 NOT NULL,
	"status_4xx" bigint DEFAULT 0 NOT NULL,
	"status_5xx" bigint DEFAULT 0 NOT NULL,
	"bytes" bigint DEFAULT 0 NOT NULL,
	"cache_hits" bigint DEFAULT 0 NOT NULL,
	"cache_misses" bigint DEFAULT 0 NOT NULL,
	"latency_sum_ms" bigint DEFAULT 0 NOT NULL,
	"latency_le_50" bigint DEFAULT 0 NOT NULL,
	"latency_le_100" bigint DEFAULT 0 NOT NULL,
	"latency_le_250" bigint DEFAULT 0 NOT NULL,
	"latency_le_500" bigint DEFAULT 0 NOT NULL,
	"latency_le_1000" bigint DEFAULT 0 NOT NULL,
	"latency_le_2500" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "service_metrics_hourly_pk" PRIMARY KEY("site_id","bucket")
);
--> statement-breakpoint
ALTER TABLE "bandwidth_usage_hourly" ADD CONSTRAINT "bandwidth_usage_hourly_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_metrics_hourly" ADD CONSTRAINT "service_metrics_hourly_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_bandwidth_usage_tenant_bucket" ON "bandwidth_usage_hourly" USING btree ("tenant_id","bucket");--> statement-breakpoint
CREATE INDEX "idx_bandwidth_usage_site_bucket" ON "bandwidth_usage_hourly" USING btree ("site_id","bucket");--> statement-breakpoint
CREATE INDEX "idx_service_metrics_site_bucket" ON "service_metrics_hourly" USING btree ("site_id","bucket");--> statement-breakpoint
CREATE INDEX "idx_service_metrics_bucket" ON "service_metrics_hourly" USING btree ("bucket");