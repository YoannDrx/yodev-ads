CREATE TABLE "mutation_observations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"approval_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"status" varchar(24) DEFAULT 'scheduled' NOT NULL,
	"window_days" integer DEFAULT 7 NOT NULL,
	"campaign_ids" text[] DEFAULT '{}' NOT NULL,
	"baseline_from" varchar(10) NOT NULL,
	"baseline_through" varchar(10) NOT NULL,
	"observation_from" varchar(10) NOT NULL,
	"observation_through" varchar(10) NOT NULL,
	"baseline_metrics" jsonb NOT NULL,
	"observed_metrics" jsonb,
	"outcome" jsonb,
	"scheduled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "approval_requests" ADD COLUMN "impact_preview" jsonb;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD COLUMN "observation_window_days" integer DEFAULT 7 NOT NULL;--> statement-breakpoint
ALTER TABLE "mutation_observations" ADD CONSTRAINT "mutation_observations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mutation_observations" ADD CONSTRAINT "mutation_observations_approval_id_approval_requests_id_fk" FOREIGN KEY ("approval_id") REFERENCES "public"."approval_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mutation_observations" ADD CONSTRAINT "mutation_observations_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mutation_observations_approval_idx" ON "mutation_observations" USING btree ("approval_id");--> statement-breakpoint
CREATE INDEX "mutation_observations_workspace_status_idx" ON "mutation_observations" USING btree ("workspace_id","status");--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_observation_window_check"
  CHECK ("observation_window_days" BETWEEN 1 AND 30);--> statement-breakpoint
ALTER TABLE "mutation_observations" ADD CONSTRAINT "mutation_observations_status_check"
  CHECK ("status" IN ('scheduled', 'completed', 'insufficient_data'));--> statement-breakpoint
ALTER TABLE "mutation_observations" ADD CONSTRAINT "mutation_observations_window_check"
  CHECK ("window_days" BETWEEN 1 AND 30 AND cardinality("campaign_ids") BETWEEN 1 AND 500);--> statement-breakpoint
ALTER TABLE "mutation_observations" ADD CONSTRAINT "mutation_observations_dates_check"
  CHECK (
    "baseline_from" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' AND
    "baseline_through" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' AND
    "observation_from" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' AND
    "observation_through" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' AND
    "baseline_from" <= "baseline_through" AND
    "baseline_through" < "observation_from" AND
    "observation_from" <= "observation_through"
  );--> statement-breakpoint
CREATE UNIQUE INDEX "mutation_observations_workspace_id_id_idx" ON "mutation_observations" ("workspace_id", "id");--> statement-breakpoint
ALTER TABLE "mutation_observations" ADD CONSTRAINT "mutation_observations_workspace_approval_fk"
  FOREIGN KEY ("workspace_id", "approval_id") REFERENCES "approval_requests" ("workspace_id", "id") NOT VALID;--> statement-breakpoint
ALTER TABLE "mutation_observations" ADD CONSTRAINT "mutation_observations_workspace_client_fk"
  FOREIGN KEY ("workspace_id", "client_id") REFERENCES "clients" ("workspace_id", "id") NOT VALID;--> statement-breakpoint
ALTER TABLE "mutation_observations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "mutation_observations" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "mutation_observations_app_select" ON "mutation_observations" FOR SELECT TO "yodev_app"
  USING ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "mutation_observations_app_insert" ON "mutation_observations" FOR INSERT TO "yodev_app"
  WITH CHECK ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "mutation_observations_system_access" ON "mutation_observations" FOR ALL TO "yodev_system"
  USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "mutation_observations_purge_access" ON "mutation_observations" FOR ALL TO "yodev_purge"
  USING (true) WITH CHECK (true);--> statement-breakpoint
GRANT SELECT, INSERT ON "mutation_observations" TO "yodev_app";--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "mutation_observations" TO "yodev_system", "yodev_purge";
