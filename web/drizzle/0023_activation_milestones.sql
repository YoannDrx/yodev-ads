CREATE TABLE "activation_milestones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"milestone" varchar(48) NOT NULL,
	"actor_user_id" varchar(64) NOT NULL,
	"source_entity_id" varchar(128),
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "activation_milestones" ADD CONSTRAINT "activation_milestones_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "activation_milestones_workspace_milestone_idx" ON "activation_milestones" USING btree ("workspace_id","milestone");--> statement-breakpoint
CREATE INDEX "activation_milestones_occurred_idx" ON "activation_milestones" USING btree ("occurred_at");
--> statement-breakpoint
ALTER TABLE "activation_milestones" ADD CONSTRAINT "activation_milestones_milestone_check" CHECK ("milestone" IN ('google_connected', 'accounts_synced', 'first_analysis', 'first_monitor', 'first_report', 'legal_accepted', 'paid_conversion'));
--> statement-breakpoint
CREATE UNIQUE INDEX "activation_milestones_workspace_id_id_idx" ON "activation_milestones" USING btree ("workspace_id","id");
--> statement-breakpoint
ALTER TABLE "activation_milestones" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "activation_milestones" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "activation_milestones_tenant_isolation" ON "activation_milestones"
  FOR ALL TO "yodev_app"
  USING ("workspace_id" = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK ("workspace_id" = current_setting('app.workspace_id', true)::uuid);
--> statement-breakpoint
CREATE POLICY "activation_milestones_system_access" ON "activation_milestones"
  FOR ALL TO "yodev_system"
  USING (true)
  WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY "activation_milestones_purge_access" ON "activation_milestones"
  FOR ALL TO "yodev_purge"
  USING (true)
  WITH CHECK (true);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "activation_milestones" TO "yodev_app", "yodev_system", "yodev_purge";
