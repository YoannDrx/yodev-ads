CREATE TABLE "report_editions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"share_id" uuid NOT NULL,
	"schedule_id" uuid,
	"kind" varchar(16) NOT NULL,
	"edition_number" integer NOT NULL,
	"deduplication_key" varchar(200) NOT NULL,
	"previous_edition_id" uuid,
	"period_from" varchar(10) NOT NULL,
	"period_through" varchar(10) NOT NULL,
	"timezone" varchar(64) NOT NULL,
	"currency_code" varchar(3) NOT NULL,
	"source_version" varchar(64) NOT NULL,
	"model_version" integer DEFAULT 1 NOT NULL,
	"payload" jsonb NOT NULL,
	"run_key" varchar(32),
	"encrypted_delivery" text,
	"delivery_token_hash" varchar(64),
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "report_schedules" ADD COLUMN "delivery_lease_owner" uuid;--> statement-breakpoint
ALTER TABLE "report_templates" ADD COLUMN "period_config" jsonb;--> statement-breakpoint
ALTER TABLE "share_links" ADD COLUMN "period_config" jsonb;--> statement-breakpoint
ALTER TABLE "share_links" ADD COLUMN "mode" varchar(16) DEFAULT 'dynamic' NOT NULL;--> statement-breakpoint
ALTER TABLE "share_links" ADD COLUMN "encrypted_report_token" text;--> statement-breakpoint
ALTER TABLE "report_editions" ADD CONSTRAINT "report_editions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_editions" ADD CONSTRAINT "report_editions_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_editions" ADD CONSTRAINT "report_editions_share_id_share_links_id_fk" FOREIGN KEY ("share_id") REFERENCES "public"."share_links"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_editions" ADD CONSTRAINT "report_editions_schedule_id_report_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."report_schedules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "report_editions_share_dedup_idx" ON "report_editions" USING btree ("share_id","deduplication_key");--> statement-breakpoint
CREATE UNIQUE INDEX "report_editions_share_number_idx" ON "report_editions" USING btree ("share_id","edition_number");--> statement-breakpoint
CREATE INDEX "report_editions_workspace_share_idx" ON "report_editions" USING btree ("workspace_id","share_id","generated_at");--> statement-breakpoint
CREATE INDEX "report_editions_expiry_idx" ON "report_editions" USING btree ("expires_at");
--> statement-breakpoint
ALTER TABLE report_editions ADD CONSTRAINT report_editions_workspace_client_fk FOREIGN KEY (workspace_id, client_id) REFERENCES clients(workspace_id, id);
--> statement-breakpoint
ALTER TABLE report_editions ADD CONSTRAINT report_editions_workspace_share_fk FOREIGN KEY (workspace_id, share_id) REFERENCES share_links(workspace_id, id);
--> statement-breakpoint
ALTER TABLE report_editions ADD CONSTRAINT report_editions_workspace_schedule_fk FOREIGN KEY (workspace_id, schedule_id) REFERENCES report_schedules(workspace_id, id);
--> statement-breakpoint
ALTER TABLE report_editions ADD CONSTRAINT report_editions_content_check CHECK (
  edition_number > 0 AND model_version > 0 AND expires_at > generated_at
  AND kind IN ('dynamic', 'initial', 'revision', 'scheduled')
  AND period_from <= period_through AND octet_length(payload::text) <= 16777216
  AND (kind <> 'scheduled' OR (run_key IS NOT NULL AND encrypted_delivery IS NOT NULL AND delivery_token_hash IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE share_links ADD CONSTRAINT share_links_mode_check CHECK (mode IN ('dynamic', 'fixed'));
--> statement-breakpoint
ALTER TABLE report_editions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE report_editions FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY report_editions_app_select ON report_editions FOR SELECT TO yodev_app USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY report_editions_app_insert ON report_editions FOR INSERT TO yodev_app WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY report_editions_system_access ON report_editions FOR ALL TO yodev_system USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY report_editions_purge_access ON report_editions FOR ALL TO yodev_purge USING (true) WITH CHECK (true);
--> statement-breakpoint
GRANT SELECT, INSERT ON report_editions TO yodev_app;
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON report_editions TO yodev_system;
--> statement-breakpoint
GRANT SELECT, DELETE ON report_editions TO yodev_purge;

--> statement-breakpoint
GRANT UPDATE (encrypted_delivery) ON report_editions TO yodev_system;

--> statement-breakpoint
ALTER TABLE report_schedules DROP CONSTRAINT report_schedules_cadence_check;
--> statement-breakpoint
ALTER TABLE report_schedules ADD CONSTRAINT report_schedules_cadence_check CHECK (
  (cadence = 'weekly' AND schedule_weekday BETWEEN 1 AND 7 AND schedule_monthday IS NULL)
  OR (cadence = 'monthly' AND schedule_monthday BETWEEN 1 AND 31 AND schedule_weekday IS NULL)
);
