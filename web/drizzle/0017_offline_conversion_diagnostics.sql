CREATE TABLE "offline_conversion_diagnostics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"snapshot_date" varchar(10) NOT NULL,
	"upload_client" varchar(64) NOT NULL,
	"status" varchar(48) NOT NULL,
	"last_upload_at" timestamp with time zone,
	"total_event_count" numeric(22, 0) DEFAULT '0' NOT NULL,
	"successful_event_count" numeric(22, 0) DEFAULT '0' NOT NULL,
	"pending_event_count" numeric(22, 0) DEFAULT '0' NOT NULL,
	"success_rate" numeric(8, 6),
	"alerts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "offline_conversion_diagnostics" ADD CONSTRAINT "offline_conversion_diagnostics_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offline_conversion_diagnostics" ADD CONSTRAINT "offline_conversion_diagnostics_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "offline_conversion_diagnostics_client_date_idx" ON "offline_conversion_diagnostics" USING btree ("client_id","upload_client","snapshot_date");--> statement-breakpoint
CREATE INDEX "offline_conversion_diagnostics_workspace_idx" ON "offline_conversion_diagnostics" USING btree ("workspace_id","snapshot_date");--> statement-breakpoint
ALTER TABLE offline_conversion_diagnostics ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE offline_conversion_diagnostics FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation_app ON offline_conversion_diagnostics TO yodev_app
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY tenant_system_access ON offline_conversion_diagnostics TO yodev_system USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY tenant_purge_access ON offline_conversion_diagnostics TO yodev_purge USING (true) WITH CHECK (true);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON offline_conversion_diagnostics TO yodev_app, yodev_system, yodev_purge;--> statement-breakpoint
CREATE UNIQUE INDEX offline_conversion_diagnostics_workspace_id_id_idx ON offline_conversion_diagnostics (workspace_id, id);--> statement-breakpoint
ALTER TABLE offline_conversion_diagnostics ADD CONSTRAINT offline_diagnostics_workspace_client_fk
  FOREIGN KEY (workspace_id, client_id) REFERENCES clients (workspace_id, id) NOT VALID;
