CREATE TABLE "pages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"tenant_id" text NOT NULL,
	"tenant_name" text NOT NULL,
	"plan" text DEFAULT 'free' NOT NULL,
	"domain" text NOT NULL,
	"project_name" text NOT NULL,
	"request" bigint DEFAULT 0 NOT NULL,
	"request_limit" bigint DEFAULT 100000 NOT NULL,
	"bandwidth_usage" bigint DEFAULT 0 NOT NULL,
	"bandwidth_limit" bigint DEFAULT 2147483648 NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "site_daily_stats" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"date" date NOT NULL,
	"requests" bigint DEFAULT 0 NOT NULL,
	"bandwidth" bigint DEFAULT 0 NOT NULL,
	"requests_2xx" bigint DEFAULT 0 NOT NULL,
	"requests_3xx" bigint DEFAULT 0 NOT NULL,
	"requests_4xx" bigint DEFAULT 0 NOT NULL,
	"requests_5xx" bigint DEFAULT 0 NOT NULL,
	"humans" bigint DEFAULT 0 NOT NULL,
	"bots" bigint DEFAULT 0 NOT NULL,
	"unique_ips" bigint DEFAULT 0 NOT NULL,
	"peak_hour" text,
	"peak_hour_requests" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "sites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subdomain" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "sites_subdomain_unique" UNIQUE("subdomain")
);
--> statement-breakpoint
ALTER TABLE "pages" ADD CONSTRAINT "pages_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_daily_stats" ADD CONSTRAINT "site_daily_stats_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_site_daily_stats_site_date" ON "site_daily_stats" USING btree ("site_id","date");--> statement-breakpoint
CREATE INDEX "idx_sites_subdomain" ON "sites" USING btree ("subdomain");