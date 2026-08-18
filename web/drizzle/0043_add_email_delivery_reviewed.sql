ALTER TABLE "transactional_email_deliveries"
  ADD CONSTRAINT "transactional_email_deliveries_status_check_v2"
  CHECK ("status" IN ('pending', 'submitting', 'accepted', 'sent', 'delivered', 'failed', 'suppressed', 'hard_bounced', 'complained', 'ambiguous', 'reviewed'))
  NOT VALID;
--> statement-breakpoint
ALTER TABLE "transactional_email_deliveries"
  VALIDATE CONSTRAINT "transactional_email_deliveries_status_check_v2";
--> statement-breakpoint
ALTER TABLE "transactional_email_deliveries"
  DROP CONSTRAINT "transactional_email_deliveries_status_check";
--> statement-breakpoint
ALTER TABLE "transactional_email_deliveries"
  RENAME CONSTRAINT "transactional_email_deliveries_status_check_v2"
  TO "transactional_email_deliveries_status_check";
