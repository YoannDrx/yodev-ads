CREATE TABLE "operating_cost_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_key" varchar(100) NOT NULL,
	"month" varchar(7) NOT NULL,
	"category" varchar(24) NOT NULL,
	"currency" varchar(3) NOT NULL,
	"basis" varchar(16) NOT NULL,
	"amount_micros" numeric(20, 0),
	"support_minutes" numeric(12, 2),
	"allocation_method" varchar(24) NOT NULL,
	"trial_weight" integer DEFAULT 0 NOT NULL,
	"solo_weight" integer DEFAULT 0 NOT NULL,
	"studio_weight" integer DEFAULT 0 NOT NULL,
	"agency_weight" integer DEFAULT 0 NOT NULL,
	"internal_weight" integer DEFAULT 0 NOT NULL,
	"unallocated_weight" integer DEFAULT 10000 NOT NULL,
	"voided" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "job_attempts" ADD COLUMN "billing_plan_at_start" varchar(16);--> statement-breakpoint
CREATE UNIQUE INDEX "operating_cost_source_idx" ON "operating_cost_entries" USING btree ("source_key");--> statement-breakpoint
CREATE INDEX "operating_cost_month_idx" ON "operating_cost_entries" USING btree ("month","currency","category");--> statement-breakpoint
CREATE INDEX "job_attempts_cost_window_idx" ON "job_attempts" USING btree ("started_at","billing_plan_at_start");--> statement-breakpoint
ALTER TABLE operating_cost_entries ADD CONSTRAINT operating_cost_evidence_check CHECK (
  source_key ~ '^[a-zA-Z0-9][a-zA-Z0-9_.:-]{2,99}$'
  AND month ~ '^20[0-9]{2}-(0[1-9]|1[0-2])$' AND currency ~ '^[A-Z]{3}$'
  AND category IN ('collections','database','functions','storage','email','support')
  AND basis IN ('documented','estimated') AND version > 0
  AND char_length(trim(updated_by)) > 0
  AND (amount_micros IS NOT NULL OR (category='support' AND support_minutes IS NOT NULL))
  AND (amount_micros IS NULL OR amount_micros BETWEEN -999999999999999 AND 999999999999999)
  AND (support_minutes IS NULL OR (category='support' AND support_minutes BETWEEN 0 AND 999999999.99))
  AND allocation_method IN ('direct','usage','workspace_days','manual','unallocated')
  AND least(trial_weight,solo_weight,studio_weight,agency_weight,internal_weight,unallocated_weight) >= 0
  AND trial_weight::bigint+solo_weight+studio_weight+agency_weight+internal_weight+unallocated_weight = 10000
  AND (allocation_method <> 'direct' OR greatest(trial_weight,solo_weight,studio_weight,agency_weight,internal_weight)=10000)
  AND (allocation_method <> 'unallocated' OR unallocated_weight=10000)
);
--> statement-breakpoint
REVOKE ALL ON operating_cost_entries FROM PUBLIC, yodev_app, yodev_auth, yodev_purge;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON operating_cost_entries TO yodev_system;
--> statement-breakpoint
ALTER TABLE job_attempts ADD CONSTRAINT job_attempts_billing_plan_check CHECK (billing_plan_at_start IS NULL OR billing_plan_at_start IN ('trial','solo','studio','agency','internal','unallocated'));
--> statement-breakpoint
CREATE FUNCTION public.capture_attempt_billing_plan() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
  IF TG_OP='UPDATE' THEN
    IF NEW.billing_plan_at_start IS DISTINCT FROM OLD.billing_plan_at_start THEN
      RAISE EXCEPTION 'Attempt billing attribution is immutable' USING ERRCODE='22023';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.workspace_id IS NULL THEN NEW.billing_plan_at_start := 'unallocated';
  ELSE
    SELECT CASE WHEN w.access_state='internal' THEN 'internal' ELSE w.plan END
    INTO NEW.billing_plan_at_start FROM public.workspaces w WHERE w.id=NEW.workspace_id;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.capture_attempt_billing_plan() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER capture_attempt_billing_plan BEFORE INSERT OR UPDATE OF billing_plan_at_start ON job_attempts FOR EACH ROW EXECUTE FUNCTION public.capture_attempt_billing_plan();
