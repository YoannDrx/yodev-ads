ALTER TABLE "notification_deliveries" ADD COLUMN "lease_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD COLUMN "dispatch_started_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "notification_deliveries_recovery_idx" ON "notification_deliveries" USING btree ("status","lease_expires_at","next_attempt_at");