CREATE TABLE "notification_oauth_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" varchar(64) NOT NULL,
	"provider" varchar(24) NOT NULL,
	"encrypted_refresh_token" text NOT NULL,
	"scopes" text[] DEFAULT '{}' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notification_oauth_sessions" ADD CONSTRAINT "notification_oauth_sessions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notification_oauth_sessions_workspace_user_idx" ON "notification_oauth_sessions" USING btree ("workspace_id","user_id","provider");--> statement-breakpoint
CREATE INDEX "notification_oauth_sessions_expiry_idx" ON "notification_oauth_sessions" USING btree ("expires_at");
--> statement-breakpoint
ALTER TABLE "notification_oauth_sessions" ADD CONSTRAINT "notification_oauth_sessions_provider_check"
  CHECK ("provider" IN ('teams'));
--> statement-breakpoint
ALTER TABLE "notification_oauth_sessions" ADD CONSTRAINT "notification_oauth_sessions_expiry_check"
  CHECK ("expires_at" > "created_at");
--> statement-breakpoint
ALTER TABLE "notification_oauth_sessions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "notification_oauth_sessions" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "notification_oauth_sessions_app_select" ON "notification_oauth_sessions" FOR SELECT TO "yodev_app"
  USING (
    "workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid
    AND "user_id" = current_setting('app.user_id', true)
  );
--> statement-breakpoint
CREATE POLICY "notification_oauth_sessions_app_insert" ON "notification_oauth_sessions" FOR INSERT TO "yodev_app"
  WITH CHECK (
    "workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid
    AND "user_id" = current_setting('app.user_id', true)
  );
--> statement-breakpoint
CREATE POLICY "notification_oauth_sessions_app_update" ON "notification_oauth_sessions" FOR UPDATE TO "yodev_app"
  USING (
    "workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid
    AND "user_id" = current_setting('app.user_id', true)
  )
  WITH CHECK (
    "workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid
    AND "user_id" = current_setting('app.user_id', true)
  );
--> statement-breakpoint
CREATE POLICY "notification_oauth_sessions_app_delete" ON "notification_oauth_sessions" FOR DELETE TO "yodev_app"
  USING (
    "workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid
    AND "user_id" = current_setting('app.user_id', true)
  );
--> statement-breakpoint
CREATE POLICY "notification_oauth_sessions_system_access" ON "notification_oauth_sessions" TO "yodev_system"
  USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY "notification_oauth_sessions_purge_access" ON "notification_oauth_sessions" TO "yodev_purge"
  USING (true) WITH CHECK (true);
--> statement-breakpoint
REVOKE ALL ON "notification_oauth_sessions" FROM PUBLIC;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "notification_oauth_sessions" TO "yodev_app", "yodev_system", "yodev_purge";
