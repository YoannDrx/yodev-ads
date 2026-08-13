CREATE TABLE "member_notification_preferences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"clerk_user_id" varchar(64) NOT NULL,
	"mention_handle" varchar(32) NOT NULL,
	"display_name" varchar(160) NOT NULL,
	"encrypted_email" text NOT NULL,
	"mention_notifications" boolean DEFAULT true NOT NULL,
	"digest_cadence" varchar(16) DEFAULT 'none' NOT NULL,
	"digest_hour" integer DEFAULT 8 NOT NULL,
	"timezone" varchar(64) DEFAULT 'Europe/Paris' NOT NULL,
	"last_digest_key" varchar(32),
	"last_digest_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "member_notification_preferences" ADD CONSTRAINT "member_notification_preferences_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "member_preferences_workspace_user_idx" ON "member_notification_preferences" USING btree ("workspace_id","clerk_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "member_preferences_workspace_handle_idx" ON "member_notification_preferences" USING btree ("workspace_id","mention_handle");--> statement-breakpoint
CREATE INDEX "member_preferences_digest_idx" ON "member_notification_preferences" USING btree ("digest_cadence","digest_hour");--> statement-breakpoint
ALTER TABLE member_notification_preferences ADD CONSTRAINT member_preferences_cadence_check
  CHECK (digest_cadence IN ('none', 'daily', 'weekly'));--> statement-breakpoint
ALTER TABLE member_notification_preferences ADD CONSTRAINT member_preferences_hour_check
  CHECK (digest_hour BETWEEN 0 AND 23);--> statement-breakpoint
ALTER TABLE member_notification_preferences ADD CONSTRAINT member_preferences_handle_check
  CHECK (mention_handle ~ '^[a-z0-9][a-z0-9_-]{1,31}$');--> statement-breakpoint
CREATE UNIQUE INDEX member_notification_preferences_workspace_id_id_idx
  ON member_notification_preferences (workspace_id, id);--> statement-breakpoint
ALTER TABLE member_notification_preferences ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE member_notification_preferences FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation_app ON member_notification_preferences TO yodev_app
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY tenant_system_access ON member_notification_preferences TO yodev_system USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY tenant_purge_access ON member_notification_preferences TO yodev_purge USING (true) WITH CHECK (true);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON member_notification_preferences TO yodev_app, yodev_system, yodev_purge;
