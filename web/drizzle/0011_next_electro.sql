CREATE TABLE "secret_revelations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" varchar(64) NOT NULL,
	"kind" varchar(32) NOT NULL,
	"encrypted_secret" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revealed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "secret_revelations" ADD CONSTRAINT "secret_revelations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "secret_revelations_lookup_idx" ON "secret_revelations" USING btree ("workspace_id","user_id","expires_at");--> statement-breakpoint
ALTER TABLE secret_revelations ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE secret_revelations FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation_app ON secret_revelations TO yodev_app
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY tenant_system_access ON secret_revelations TO yodev_system USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY tenant_purge_access ON secret_revelations TO yodev_purge USING (true) WITH CHECK (true);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON secret_revelations TO yodev_app, yodev_system, yodev_purge;
