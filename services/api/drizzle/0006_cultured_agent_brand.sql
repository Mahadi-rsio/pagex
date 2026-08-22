CREATE INDEX "idx_deployments_page_active" ON "deployments" USING btree ("page_id","is_active");--> statement-breakpoint
CREATE INDEX "idx_deployments_page_tenant_version" ON "deployments" USING btree ("page_id","tenant_id","version");--> statement-breakpoint
CREATE INDEX "idx_deployments_page_tenant" ON "deployments" USING btree ("page_id","tenant_id");--> statement-breakpoint
CREATE INDEX "idx_pages_tenant" ON "pages" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_pages_domain" ON "pages" USING btree ("domain");--> statement-breakpoint
CREATE INDEX "idx_pages_project_tenant" ON "pages" USING btree ("project_name","tenant_id");