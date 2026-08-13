ALTER TABLE "jobs" ADD COLUMN "deduplication_key" varchar(240);--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "timezone" varchar(64) DEFAULT 'Europe/Paris' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_deduplication_idx" ON "jobs" USING btree ("deduplication_key");