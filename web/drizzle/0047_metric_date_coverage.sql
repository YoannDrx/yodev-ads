ALTER TABLE "daily_account_metrics" ADD COLUMN "timezone" varchar(64);--> statement-breakpoint
ALTER TABLE "daily_account_metrics" ADD COLUMN "coverage_status" varchar(24) DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
ALTER TABLE "daily_account_metrics" ADD COLUMN "source_observed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "daily_account_metrics" ADD COLUMN "source_version" varchar(64);--> statement-breakpoint
ALTER TABLE "daily_account_metrics" ADD COLUMN "account_rows" integer;--> statement-breakpoint
ALTER TABLE "daily_account_metrics" ADD COLUMN "campaign_rows" integer;