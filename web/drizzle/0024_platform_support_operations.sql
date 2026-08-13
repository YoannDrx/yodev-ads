CREATE TABLE "platform_incident_updates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"incident_id" uuid NOT NULL,
	"created_by" varchar(64) NOT NULL,
	"status" varchar(24) NOT NULL,
	"message_fr" text NOT NULL,
	"message_en" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_incidents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_by" varchar(64) NOT NULL,
	"title_fr" varchar(220) NOT NULL,
	"title_en" varchar(220) NOT NULL,
	"component" varchar(32) NOT NULL,
	"impact" varchar(24) NOT NULL,
	"status" varchar(24) DEFAULT 'investigating' NOT NULL,
	"public" boolean DEFAULT true NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "support_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"ticket_id" uuid NOT NULL,
	"author_user_id" varchar(64) NOT NULL,
	"author_kind" varchar(24) NOT NULL,
	"body" text NOT NULL,
	"internal" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "support_tickets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"requested_by" varchar(64) NOT NULL,
	"subject" varchar(220) NOT NULL,
	"category" varchar(32) NOT NULL,
	"priority" varchar(24) DEFAULT 'normal' NOT NULL,
	"status" varchar(24) DEFAULT 'open' NOT NULL,
	"assigned_to" varchar(64),
	"last_message_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "platform_incident_updates" ADD CONSTRAINT "platform_incident_updates_incident_id_platform_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."platform_incidents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_ticket_id_support_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."support_tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "platform_incident_updates_incident_idx" ON "platform_incident_updates" USING btree ("incident_id","created_at");--> statement-breakpoint
CREATE INDEX "platform_incidents_public_date_idx" ON "platform_incidents" USING btree ("public","started_at");--> statement-breakpoint
CREATE INDEX "support_messages_ticket_idx" ON "support_messages" USING btree ("workspace_id","ticket_id","created_at");--> statement-breakpoint
CREATE INDEX "support_tickets_workspace_status_idx" ON "support_tickets" USING btree ("workspace_id","status","last_message_at");--> statement-breakpoint
CREATE INDEX "support_tickets_status_priority_idx" ON "support_tickets" USING btree ("status","priority","last_message_at");
--> statement-breakpoint
ALTER TABLE "platform_incidents" ADD CONSTRAINT "platform_incidents_component_check" CHECK ("component" IN ('application', 'database', 'google_ads', 'stripe', 'email', 'scheduler'));
--> statement-breakpoint
ALTER TABLE "platform_incidents" ADD CONSTRAINT "platform_incidents_impact_check" CHECK ("impact" IN ('maintenance', 'degraded', 'partial_outage', 'major_outage'));
--> statement-breakpoint
ALTER TABLE "platform_incidents" ADD CONSTRAINT "platform_incidents_status_check" CHECK ("status" IN ('investigating', 'identified', 'monitoring', 'resolved'));
--> statement-breakpoint
ALTER TABLE "platform_incident_updates" ADD CONSTRAINT "platform_incident_updates_status_check" CHECK ("status" IN ('investigating', 'identified', 'monitoring', 'resolved'));
--> statement-breakpoint
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_category_check" CHECK ("category" IN ('technical', 'billing', 'google_ads', 'feature', 'data_privacy'));
--> statement-breakpoint
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_priority_check" CHECK ("priority" IN ('normal', 'high', 'urgent'));
--> statement-breakpoint
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_status_check" CHECK ("status" IN ('open', 'awaiting_support', 'awaiting_customer', 'resolved', 'closed'));
--> statement-breakpoint
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_subject_check" CHECK (char_length(trim("subject")) BETWEEN 4 AND 220);
--> statement-breakpoint
ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_author_kind_check" CHECK ("author_kind" IN ('customer', 'support', 'system'));
--> statement-breakpoint
ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_body_check" CHECK (char_length(trim("body")) BETWEEN 1 AND 8000);
--> statement-breakpoint
CREATE UNIQUE INDEX "support_tickets_workspace_id_id_idx" ON "support_tickets" ("workspace_id", "id");
--> statement-breakpoint
CREATE UNIQUE INDEX "support_messages_workspace_id_id_idx" ON "support_messages" ("workspace_id", "id");
--> statement-breakpoint
ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_workspace_ticket_fk"
  FOREIGN KEY ("workspace_id", "ticket_id") REFERENCES "support_tickets" ("workspace_id", "id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "support_tickets" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "support_tickets" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "support_tickets_app_select" ON "support_tickets" FOR SELECT TO "yodev_app"
  USING ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "support_tickets_app_insert" ON "support_tickets" FOR INSERT TO "yodev_app"
  WITH CHECK (
    "workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid
    AND "requested_by" = current_setting('app.user_id', true)
    AND "assigned_to" IS NULL
    AND "status" IN ('open', 'awaiting_support')
  );
--> statement-breakpoint
CREATE POLICY "support_tickets_app_update" ON "support_tickets" FOR UPDATE TO "yodev_app"
  USING ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (
    "workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid
    AND "status" IN ('open', 'awaiting_support')
  );
--> statement-breakpoint
CREATE POLICY "support_tickets_system_access" ON "support_tickets" TO "yodev_system" USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY "support_tickets_purge_access" ON "support_tickets" TO "yodev_purge" USING (true) WITH CHECK (true);
--> statement-breakpoint
ALTER TABLE "support_messages" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "support_messages" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "support_messages_app_select" ON "support_messages" FOR SELECT TO "yodev_app"
  USING ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid AND "internal" = false);
--> statement-breakpoint
CREATE POLICY "support_messages_app_insert" ON "support_messages" FOR INSERT TO "yodev_app"
  WITH CHECK (
    "workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid
    AND "author_user_id" = current_setting('app.user_id', true)
    AND "internal" = false
    AND "author_kind" = 'customer'
  );
--> statement-breakpoint
CREATE POLICY "support_messages_system_access" ON "support_messages" TO "yodev_system" USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY "support_messages_purge_access" ON "support_messages" TO "yodev_purge" USING (true) WITH CHECK (true);
--> statement-breakpoint
GRANT SELECT, INSERT ON "support_tickets" TO "yodev_app";
--> statement-breakpoint
GRANT UPDATE ("status", "last_message_at", "resolved_at", "updated_at") ON "support_tickets" TO "yodev_app";
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "support_tickets", "support_messages" TO "yodev_system", "yodev_purge";
--> statement-breakpoint
GRANT SELECT, INSERT ON "support_messages" TO "yodev_app";
--> statement-breakpoint
REVOKE ALL ON "platform_incidents", "platform_incident_updates" FROM PUBLIC, "yodev_app", "yodev_purge";
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "platform_incidents", "platform_incident_updates" TO "yodev_system";
