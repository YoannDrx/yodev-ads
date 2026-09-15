CREATE TABLE "portfolio_views" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" varchar(64) NOT NULL,
	"name" varchar(80) NOT NULL,
	"criteria" jsonb NOT NULL,
	"version" uuid DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "portfolio_views" ADD CONSTRAINT "portfolio_views_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "portfolio_views_owner_idx" ON "portfolio_views" USING btree ("workspace_id","user_id","created_at");--> statement-breakpoint
ALTER TABLE "portfolio_views" ADD CONSTRAINT "portfolio_views_criteria_size" CHECK (jsonb_typeof(criteria)='object' AND octet_length(criteria::text)<=4096);
--> statement-breakpoint
ALTER TABLE "portfolio_views" ADD CONSTRAINT "portfolio_views_nonempty" CHECK (length(trim(name))>0 AND length(user_id)>0);
--> statement-breakpoint
ALTER TABLE "portfolio_views" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "portfolio_views" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "portfolio_views_app_owner" ON "portfolio_views" FOR ALL TO "yodev_app"
  USING (workspace_id=nullif(current_setting('app.workspace_id',true),'')::uuid AND user_id=current_setting('app.user_id',true))
  WITH CHECK (workspace_id=nullif(current_setting('app.workspace_id',true),'')::uuid AND user_id=current_setting('app.user_id',true));
--> statement-breakpoint
CREATE POLICY "portfolio_views_system_access" ON "portfolio_views" FOR ALL TO "yodev_system" USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY "portfolio_views_purge_access" ON "portfolio_views" FOR ALL TO "yodev_purge" USING (true) WITH CHECK (true);
--> statement-breakpoint
REVOKE ALL ON "portfolio_views" FROM PUBLIC;
--> statement-breakpoint
GRANT SELECT,INSERT,UPDATE,DELETE ON "portfolio_views" TO "yodev_app", "yodev_system", "yodev_purge";
