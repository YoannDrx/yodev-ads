CREATE TABLE "operational_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"component" varchar(64) NOT NULL,
	"run_key" varchar(160) NOT NULL,
	"status" varchar(24) DEFAULT 'running' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"duration_ms" integer,
	"work_count" integer DEFAULT 0 NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error_message" text,
	"next_expected_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "operational_runs_component_key_idx" ON "operational_runs" USING btree ("component","run_key");--> statement-breakpoint
CREATE INDEX "operational_runs_component_started_idx" ON "operational_runs" USING btree ("component","started_at");--> statement-breakpoint
ALTER TABLE "operational_runs" ADD CONSTRAINT "operational_runs_status_check"
  CHECK ("status" IN ('running', 'completed', 'failed'));--> statement-breakpoint
ALTER TABLE "operational_runs" ADD CONSTRAINT "operational_runs_values_check"
  CHECK ("work_count" >= 0 AND ("duration_ms" IS NULL OR "duration_ms" >= 0));--> statement-breakpoint
REVOKE ALL ON "operational_runs" FROM PUBLIC, "yodev_app", "yodev_auth";--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "operational_runs" TO "yodev_system", "yodev_purge";
