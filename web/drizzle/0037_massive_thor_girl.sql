ALTER TABLE "transactional_email_deliveries" ADD COLUMN "content_hash" varchar(64) NOT NULL;--> statement-breakpoint
ALTER TABLE "transactional_email_deliveries" ADD CONSTRAINT "transactional_email_deliveries_content_hash_check"
  CHECK ("content_hash" ~ '^[0-9a-f]{64}$');
