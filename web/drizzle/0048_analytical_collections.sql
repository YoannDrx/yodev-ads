CREATE TABLE "analytical_collections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"family" varchar(40) NOT NULL,
	"contract_version" integer NOT NULL,
	"period_from" varchar(10) NOT NULL,
	"period_through" varchar(10) NOT NULL,
	"timezone" varchar(64) NOT NULL,
	"currency_code" varchar(3) NOT NULL,
	"source_version" uuid NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"collected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"payload" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "analytical_collections" ADD CONSTRAINT "analytical_collections_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytical_collections" ADD CONSTRAINT "analytical_collections_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "analytical_collections_client_family_idx" ON "analytical_collections" USING btree ("client_id","family");--> statement-breakpoint
CREATE INDEX "analytical_collections_workspace_idx" ON "analytical_collections" USING btree ("workspace_id","client_id");
--> statement-breakpoint
ALTER TABLE "analytical_collections" ADD CONSTRAINT "analytical_collections_workspace_client_fk"
  FOREIGN KEY ("workspace_id", "client_id") REFERENCES "clients" ("workspace_id", "id");
--> statement-breakpoint
ALTER TABLE "analytical_collections" ADD CONSTRAINT "analytical_collections_payload_size" CHECK (octet_length(payload::text) <= 2097152);
--> statement-breakpoint
ALTER TABLE "analytical_collections" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "analytical_collections" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "analytical_collections_app_select" ON "analytical_collections" FOR SELECT TO "yodev_app"
  USING ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "analytical_collections_system_access" ON "analytical_collections" FOR ALL TO "yodev_system" USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY "analytical_collections_purge_access" ON "analytical_collections" FOR ALL TO "yodev_purge" USING (true) WITH CHECK (true);
--> statement-breakpoint
GRANT SELECT ON "analytical_collections" TO "yodev_app";
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "analytical_collections" TO "yodev_system", "yodev_purge";
--> statement-breakpoint
CREATE INDEX "jobs_analytical_client_family_idx" ON "jobs" ("workspace_id", (payload->>'clientId'), (payload->>'family'), "created_at" DESC, "id" DESC) WHERE type = 'analytics.collect';
