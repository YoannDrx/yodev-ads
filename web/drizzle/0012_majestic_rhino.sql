ALTER TABLE "report_recipients" ADD COLUMN "otp_attempt_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "report_recipients" ADD COLUMN "session_token_hash" varchar(64);--> statement-breakpoint
ALTER TABLE "report_recipients" ADD COLUMN "session_expires_at" timestamp with time zone;