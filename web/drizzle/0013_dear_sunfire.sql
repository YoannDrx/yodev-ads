CREATE TABLE "workspace_deletion_tombstones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_hash" varchar(64) NOT NULL,
	"deletion_requested_at" timestamp with time zone NOT NULL,
	"purged_at" timestamp with time zone DEFAULT now() NOT NULL,
	"retain_until" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "deletion_requests" ADD COLUMN "previous_access_state" varchar(32) DEFAULT 'suspended' NOT NULL;--> statement-breakpoint
ALTER TABLE "deletion_requests" ALTER COLUMN "previous_access_state" DROP DEFAULT;--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_tombstones_hash_idx" ON "workspace_deletion_tombstones" USING btree ("workspace_hash");--> statement-breakpoint
REVOKE ALL ON workspace_deletion_tombstones FROM PUBLIC, yodev_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON workspace_deletion_tombstones TO yodev_system, yodev_purge;
