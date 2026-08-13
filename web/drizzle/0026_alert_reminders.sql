ALTER TABLE "alert_incidents" ADD COLUMN "last_notified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "monitoring_agents" ADD COLUMN "reminder_interval_hours" integer;--> statement-breakpoint
ALTER TABLE "monitoring_agents" ADD CONSTRAINT "monitoring_agents_reminder_interval_check"
  CHECK ("reminder_interval_hours" IS NULL OR "reminder_interval_hours" BETWEEN 1 AND 720);
