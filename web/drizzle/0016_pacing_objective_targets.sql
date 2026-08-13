ALTER TABLE "client_goals" ADD COLUMN "target_conversions" numeric(22, 4);--> statement-breakpoint
ALTER TABLE "client_goals" ADD COLUMN "target_conversion_value_micros" numeric(22, 0);
