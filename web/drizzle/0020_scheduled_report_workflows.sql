CREATE TABLE "report_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"template_id" uuid,
	"share_id" uuid NOT NULL,
	"created_by" varchar(64) NOT NULL,
	"name" varchar(160) NOT NULL,
	"cadence" varchar(16) NOT NULL,
	"schedule_weekday" integer,
	"schedule_monthday" integer,
	"send_hour" integer DEFAULT 8 NOT NULL,
	"timezone" varchar(64) DEFAULT 'Europe/Paris' NOT NULL,
	"recipient_emails" text[] DEFAULT '{}' NOT NULL,
	"encrypted_report_token" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_run_key" varchar(32),
	"last_delivered_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"created_by" varchar(64) NOT NULL,
	"name" varchar(160) NOT NULL,
	"locale" varchar(8) DEFAULT 'fr' NOT NULL,
	"period_days" integer DEFAULT 30 NOT NULL,
	"editorial_comment" text,
	"action_plan" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "report_schedules" ADD CONSTRAINT "report_schedules_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_schedules" ADD CONSTRAINT "report_schedules_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_schedules" ADD CONSTRAINT "report_schedules_template_id_report_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."report_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_schedules" ADD CONSTRAINT "report_schedules_share_id_share_links_id_fk" FOREIGN KEY ("share_id") REFERENCES "public"."share_links"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_templates" ADD CONSTRAINT "report_templates_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "report_schedules_share_idx" ON "report_schedules" USING btree ("share_id");--> statement-breakpoint
CREATE INDEX "report_schedules_due_idx" ON "report_schedules" USING btree ("enabled","cadence","send_hour");--> statement-breakpoint
CREATE INDEX "report_schedules_workspace_idx" ON "report_schedules" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "report_templates_workspace_name_idx" ON "report_templates" USING btree ("workspace_id","name");--> statement-breakpoint
ALTER TABLE report_templates ADD CONSTRAINT report_templates_locale_check CHECK (locale IN ('fr', 'en'));--> statement-breakpoint
ALTER TABLE report_templates ADD CONSTRAINT report_templates_period_check CHECK (period_days IN (7, 30, 90));--> statement-breakpoint
ALTER TABLE report_schedules ADD CONSTRAINT report_schedules_cadence_check CHECK (
  (cadence = 'weekly' AND schedule_weekday BETWEEN 1 AND 7 AND schedule_monthday IS NULL)
  OR (cadence = 'monthly' AND schedule_monthday BETWEEN 1 AND 28 AND schedule_weekday IS NULL)
);--> statement-breakpoint
ALTER TABLE report_schedules ADD CONSTRAINT report_schedules_hour_check CHECK (send_hour BETWEEN 0 AND 23);--> statement-breakpoint
ALTER TABLE report_schedules ADD CONSTRAINT report_schedules_recipients_check CHECK (cardinality(recipient_emails) BETWEEN 1 AND 20);--> statement-breakpoint
CREATE UNIQUE INDEX report_templates_workspace_id_id_idx ON report_templates (workspace_id, id);--> statement-breakpoint
CREATE UNIQUE INDEX report_schedules_workspace_id_id_idx ON report_schedules (workspace_id, id);--> statement-breakpoint
ALTER TABLE report_schedules ADD CONSTRAINT report_schedules_workspace_client_fk
  FOREIGN KEY (workspace_id, client_id) REFERENCES clients (workspace_id, id) NOT VALID;--> statement-breakpoint
ALTER TABLE report_schedules ADD CONSTRAINT report_schedules_workspace_template_fk
  FOREIGN KEY (workspace_id, template_id) REFERENCES report_templates (workspace_id, id) NOT VALID;--> statement-breakpoint
ALTER TABLE report_schedules ADD CONSTRAINT report_schedules_workspace_share_fk
  FOREIGN KEY (workspace_id, share_id) REFERENCES share_links (workspace_id, id) NOT VALID;--> statement-breakpoint
ALTER TABLE report_templates ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE report_templates FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation_app ON report_templates TO yodev_app
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY tenant_system_access ON report_templates TO yodev_system USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY tenant_purge_access ON report_templates TO yodev_purge USING (true) WITH CHECK (true);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON report_templates TO yodev_app, yodev_system, yodev_purge;--> statement-breakpoint
ALTER TABLE report_schedules ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE report_schedules FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation_app ON report_schedules TO yodev_app
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY tenant_system_access ON report_schedules TO yodev_system USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY tenant_purge_access ON report_schedules TO yodev_purge USING (true) WITH CHECK (true);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON report_schedules TO yodev_app, yodev_system, yodev_purge;
