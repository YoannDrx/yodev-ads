CREATE TABLE "subprocessor_change_notices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_by" varchar(64) NOT NULL,
	"vendor_name" varchar(160) NOT NULL,
	"change_type" varchar(24) NOT NULL,
	"summary_fr" text NOT NULL,
	"summary_en" text NOT NULL,
	"effective_at" timestamp with time zone NOT NULL,
	"status" varchar(24) DEFAULT 'scheduled' NOT NULL,
	"notified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "subprocessor_change_notices_due_idx" ON "subprocessor_change_notices" USING btree ("status","created_at");
--> statement-breakpoint
ALTER TABLE "subprocessor_change_notices" ADD CONSTRAINT "subprocessor_change_notices_type_check"
  CHECK ("change_type" IN ('addition', 'replacement', 'removal'));
--> statement-breakpoint
ALTER TABLE "subprocessor_change_notices" ADD CONSTRAINT "subprocessor_change_notices_status_check"
  CHECK ("status" IN ('scheduled', 'completed', 'cancelled'));
--> statement-breakpoint
ALTER TABLE "subprocessor_change_notices" ADD CONSTRAINT "subprocessor_change_notices_notice_check"
  CHECK (
    char_length(trim("vendor_name")) BETWEEN 2 AND 160
    AND char_length(trim("summary_fr")) BETWEEN 10 AND 5000
    AND char_length(trim("summary_en")) BETWEEN 10 AND 5000
    AND "effective_at" >= "created_at" + interval '15 days'
  );
--> statement-breakpoint
REVOKE ALL ON "subprocessor_change_notices" FROM PUBLIC, "yodev_app", "yodev_purge";
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "subprocessor_change_notices" TO "yodev_system";
