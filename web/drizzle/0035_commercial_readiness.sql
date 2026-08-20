CREATE TABLE "transactional_email_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid,
	"category" varchar(64) NOT NULL,
	"business_key" varchar(240) NOT NULL,
	"recipient_hash" varchar(64) NOT NULL,
	"provider_message_id" uuid,
	"status" varchar(24) DEFAULT 'pending' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"accepted_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"terminal_at" timestamp with time zone,
	"last_event_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "requested_plan" varchar(24);--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "requested_plan_effective_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "billing_reconciliation_required" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "billing_reconciliation_reason" text;--> statement-breakpoint
ALTER TABLE "transactional_email_deliveries" ADD CONSTRAINT "transactional_email_deliveries_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "transactional_email_deliveries_business_idx" ON "transactional_email_deliveries" USING btree ("business_key");--> statement-breakpoint
CREATE UNIQUE INDEX "transactional_email_deliveries_message_idx" ON "transactional_email_deliveries" USING btree ("provider_message_id");--> statement-breakpoint
CREATE INDEX "transactional_email_deliveries_workspace_idx" ON "transactional_email_deliveries" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "transactional_email_deliveries_status_idx" ON "transactional_email_deliveries" USING btree ("status","updated_at");--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_requested_plan_check"
  CHECK ("requested_plan" IS NULL OR "requested_plan" IN ('solo', 'studio', 'agency'));--> statement-breakpoint
ALTER TABLE "transactional_email_deliveries" ADD CONSTRAINT "transactional_email_deliveries_status_check"
  CHECK ("status" IN ('pending', 'submitting', 'accepted', 'sent', 'delivered', 'failed', 'suppressed', 'hard_bounced', 'complained', 'ambiguous'));--> statement-breakpoint
ALTER TABLE "transactional_email_deliveries" ADD CONSTRAINT "transactional_email_deliveries_values_check"
  CHECK (
    char_length("category") BETWEEN 1 AND 64
    AND char_length("business_key") BETWEEN 1 AND 240
    AND "recipient_hash" ~ '^[0-9a-f]{64}$'
    AND "attempt_count" >= 0
  );--> statement-breakpoint
ALTER TABLE "transactional_email_deliveries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "transactional_email_deliveries" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "transactional_email_deliveries_app_select" ON "transactional_email_deliveries"
  FOR SELECT TO "yodev_app"
  USING ("workspace_id" = current_setting('app.workspace_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "transactional_email_deliveries_system_access" ON "transactional_email_deliveries"
  FOR ALL TO "yodev_system" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "transactional_email_deliveries_purge_access" ON "transactional_email_deliveries"
  FOR ALL TO "yodev_purge" USING (true) WITH CHECK (true);--> statement-breakpoint
GRANT SELECT ON "transactional_email_deliveries" TO "yodev_app";--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "transactional_email_deliveries" TO "yodev_system", "yodev_purge";
