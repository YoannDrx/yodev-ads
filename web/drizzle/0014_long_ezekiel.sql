CREATE TABLE "alert_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"incident_id" uuid NOT NULL,
	"author_user_id" varchar(64) NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "alert_incidents" ADD COLUMN "assigned_to" varchar(64);--> statement-breakpoint
ALTER TABLE "alert_incidents" ADD COLUMN "due_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "alert_incidents" ADD COLUMN "acknowledged_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "alert_incidents" ADD COLUMN "snoozed_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "alert_incidents" ADD COLUMN "occurrence_count" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "alert_comments" ADD CONSTRAINT "alert_comments_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_comments" ADD CONSTRAINT "alert_comments_incident_id_alert_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."alert_incidents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "alert_comments_incident_idx" ON "alert_comments" USING btree ("workspace_id","incident_id","created_at");--> statement-breakpoint
ALTER TABLE alert_comments ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE alert_comments FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation_app ON alert_comments TO yodev_app
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY tenant_system_access ON alert_comments TO yodev_system USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY tenant_purge_access ON alert_comments TO yodev_purge USING (true) WITH CHECK (true);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON alert_comments TO yodev_app, yodev_system, yodev_purge;--> statement-breakpoint
CREATE UNIQUE INDEX alert_comments_workspace_id_id_idx ON alert_comments (workspace_id, id);--> statement-breakpoint
ALTER TABLE alert_comments ADD CONSTRAINT alert_comments_workspace_incident_fk
  FOREIGN KEY (workspace_id, incident_id) REFERENCES alert_incidents (workspace_id, id) NOT VALID;
