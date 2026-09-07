CREATE TABLE "domain_cleanup_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hostname" varchar(253) NOT NULL,
	"workspace_hash" varchar(64) NOT NULL,
	"job_id" uuid NOT NULL,
	"job_attempt" integer NOT NULL,
	"lease_owner" varchar(128) NOT NULL,
	"provider_scope_hash" varchar(64) NOT NULL,
	"state" varchar(24) DEFAULT 'submitting' NOT NULL,
	"already_absent" boolean,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX "domain_cleanup_attempt_idx" ON "domain_cleanup_attempts" USING btree ("job_id","job_attempt","hostname");--> statement-breakpoint
CREATE INDEX "domain_cleanup_attempt_scope_idx" ON "domain_cleanup_attempts" USING btree ("hostname","workspace_hash");
--> statement-breakpoint
ALTER TABLE domain_cleanup_attempts ADD CONSTRAINT domain_cleanup_attempt_shape CHECK (
  job_attempt > 0 AND length(btrim(lease_owner)) > 0 AND workspace_hash ~ '^[a-f0-9]{64}$'
  AND provider_scope_hash ~ '^[a-f0-9]{64}$'
  AND hostname=lower(btrim(hostname)) AND length(hostname) BETWEEN 4 AND 253
  AND state IN ('submitting','confirmed','ambiguous','not_submitted')
  AND ((state='submitting' AND finished_at IS NULL) OR (state<>'submitting' AND finished_at IS NOT NULL))
  AND ((state='confirmed' AND already_absent IS NOT NULL) OR (state<>'confirmed' AND already_absent IS NULL))
);
--> statement-breakpoint
REVOKE ALL ON domain_cleanup_attempts FROM PUBLIC,yodev_app,yodev_auth,yodev_purge;
--> statement-breakpoint
GRANT SELECT,INSERT,UPDATE ON domain_cleanup_attempts TO yodev_system;
--> statement-breakpoint
CREATE FUNCTION public.guard_domain_cleanup_receipt() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
  IF ROW(NEW.id,NEW.hostname,NEW.workspace_hash,NEW.job_id,NEW.job_attempt,NEW.lease_owner,NEW.provider_scope_hash,NEW.created_at)
    IS DISTINCT FROM ROW(OLD.id,OLD.hostname,OLD.workspace_hash,OLD.job_id,OLD.job_attempt,OLD.lease_owner,OLD.provider_scope_hash,OLD.created_at)
    OR OLD.state<>'submitting' THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Domain cleanup attempt evidence is immutable';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.guard_domain_cleanup_receipt() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER guard_domain_cleanup_receipt BEFORE UPDATE ON domain_cleanup_attempts FOR EACH ROW EXECUTE FUNCTION public.guard_domain_cleanup_receipt();
