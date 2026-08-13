CREATE TABLE "report_template_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"template_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"edited_by" varchar(64) NOT NULL,
	"snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "report_templates" ADD COLUMN "current_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "report_template_versions" ADD CONSTRAINT "report_template_versions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_template_versions" ADD CONSTRAINT "report_template_versions_template_id_report_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."report_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "report_template_versions_template_version_idx" ON "report_template_versions" USING btree ("template_id","version");--> statement-breakpoint
CREATE INDEX "report_template_versions_workspace_idx" ON "report_template_versions" USING btree ("workspace_id","created_at");--> statement-breakpoint
INSERT INTO "report_template_versions" ("workspace_id", "template_id", "version", "edited_by", "snapshot", "created_at")
SELECT "workspace_id", "id", 1, "created_by",
  jsonb_build_object(
    'name', "name",
    'locale', "locale",
    'periodDays', "period_days",
    'editorialComment', "editorial_comment",
    'actionPlan', "action_plan"
  ),
  "created_at"
FROM "report_templates"
ON CONFLICT ("template_id", "version") DO NOTHING;--> statement-breakpoint
ALTER TABLE "report_templates" ADD CONSTRAINT "report_templates_current_version_check"
  CHECK ("current_version" > 0);--> statement-breakpoint
ALTER TABLE "report_template_versions" ADD CONSTRAINT "report_template_versions_version_check"
  CHECK ("version" > 0);--> statement-breakpoint
CREATE UNIQUE INDEX "report_template_versions_workspace_id_id_idx"
  ON "report_template_versions" ("workspace_id", "id");--> statement-breakpoint
ALTER TABLE "report_template_versions" ADD CONSTRAINT "report_template_versions_workspace_template_fk"
  FOREIGN KEY ("workspace_id", "template_id") REFERENCES "report_templates" ("workspace_id", "id") NOT VALID;--> statement-breakpoint
ALTER TABLE "report_template_versions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "report_template_versions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "report_template_versions_app_select" ON "report_template_versions" FOR SELECT TO "yodev_app"
  USING ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "report_template_versions_app_insert" ON "report_template_versions" FOR INSERT TO "yodev_app"
  WITH CHECK ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "report_template_versions_system_access" ON "report_template_versions" FOR ALL TO "yodev_system"
  USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "report_template_versions_purge_access" ON "report_template_versions" FOR ALL TO "yodev_purge"
  USING (true) WITH CHECK (true);--> statement-breakpoint
GRANT SELECT, INSERT ON "report_template_versions" TO "yodev_app";--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "report_template_versions" TO "yodev_system", "yodev_purge";
