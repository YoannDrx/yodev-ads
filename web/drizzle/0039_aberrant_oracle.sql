ALTER TABLE "deletion_requests" ADD COLUMN "stripe_subscription_id" varchar(64);--> statement-breakpoint
ALTER TABLE "deletion_requests" ADD COLUMN "stripe_cancellation_state" varchar(24) DEFAULT 'not_required' NOT NULL;--> statement-breakpoint
ALTER TABLE "deletion_requests" ADD COLUMN "stripe_cancellation_confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "deletion_requests" ADD COLUMN "stripe_cancellation_error" text;--> statement-breakpoint
ALTER TABLE "deletion_requests" ADD COLUMN "google_revocation_state" varchar(24) DEFAULT 'not_required' NOT NULL;--> statement-breakpoint
ALTER TABLE "deletion_requests" ADD COLUMN "google_revocation_confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "deletion_requests" ADD COLUMN "google_revocation_error" text;--> statement-breakpoint
ALTER TABLE "workspace_deletion_tombstones" ADD COLUMN "external_cleanup_status" varchar(24) DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace_deletion_tombstones" ADD COLUMN "external_cleanup_error" text;--> statement-breakpoint
ALTER TABLE "workspace_deletion_tombstones" ADD COLUMN "external_cleanup_completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "deletion_requests" ADD CONSTRAINT "deletion_requests_stripe_cancellation_state_check"
  CHECK ("stripe_cancellation_state" IN ('not_required', 'pending', 'confirmed', 'failed'));--> statement-breakpoint
ALTER TABLE "deletion_requests" ADD CONSTRAINT "deletion_requests_google_revocation_state_check"
  CHECK ("google_revocation_state" IN ('not_required', 'pending', 'confirmed', 'failed'));--> statement-breakpoint
ALTER TABLE "workspace_deletion_tombstones" ADD CONSTRAINT "workspace_deletion_tombstones_external_cleanup_status_check"
  CHECK ("external_cleanup_status" IN ('pending', 'running', 'completed', 'failed'));
