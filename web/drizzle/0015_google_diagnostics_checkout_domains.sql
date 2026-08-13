ALTER TABLE "conversion_action_snapshots" ADD COLUMN "action_type" varchar(96);--> statement-breakpoint
ALTER TABLE "conversion_action_snapshots" ADD COLUMN "last_conversion_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "conversion_action_snapshots" ADD COLUMN "last_received_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "google_change_events" ADD COLUMN "changed_resource_name" text;--> statement-breakpoint
ALTER TABLE "google_change_events" ADD COLUMN "client_type" varchar(64);--> statement-breakpoint
ALTER TABLE "google_change_events" ADD COLUMN "changed_fields" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace_domains" ADD COLUMN "vercel_configuration" jsonb;--> statement-breakpoint
ALTER TABLE "workspace_domains" ADD COLUMN "last_error" text;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "checkout_attempt_id" uuid;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "checkout_reserved_at" timestamp with time zone;
