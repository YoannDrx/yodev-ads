CREATE TABLE "workspace_domain_cleanup_reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hostname" varchar(253) NOT NULL,
	"workspace_hash" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"released_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX "domain_cleanup_reservation_idx" ON "workspace_domain_cleanup_reservations" USING btree ("hostname","workspace_hash");--> statement-breakpoint
ALTER TABLE workspace_domain_cleanup_reservations ADD CONSTRAINT domain_cleanup_reservation_shape CHECK (
  hostname=lower(btrim(hostname)) AND hostname ~ '^[a-z0-9][a-z0-9.-]*[a-z0-9]$' AND length(hostname) BETWEEN 4 AND 253 AND workspace_hash ~ '^[a-f0-9]{64}$'
);
--> statement-breakpoint
REVOKE ALL ON workspace_domain_cleanup_reservations FROM PUBLIC,yodev_app,yodev_auth;
--> statement-breakpoint
GRANT SELECT,INSERT,UPDATE ON workspace_domain_cleanup_reservations TO yodev_system,yodev_purge;
--> statement-breakpoint
-- Do not silently discard an old cleanup's targets. Malformed durable payloads need reconciliation before migration.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM jobs WHERE type='workspace.external_cleanup' AND (
    jsonb_typeof(payload->'hostnames') IS DISTINCT FROM 'array'
    OR coalesce(payload->>'workspaceHash','') !~ '^[a-f0-9]{64}$'
  )) THEN RAISE EXCEPTION 'Reconcile malformed external cleanup jobs before migration'; END IF;
END $$;
--> statement-breakpoint
INSERT INTO workspace_domain_cleanup_reservations(hostname,workspace_hash)
SELECT DISTINCT target.hostname,j.payload->>'workspaceHash'
FROM jobs j CROSS JOIN LATERAL jsonb_array_elements_text(CASE WHEN j.type='workspace.external_cleanup' THEN j.payload->'hostnames' ELSE '[]'::jsonb END) AS target(hostname)
WHERE j.type='workspace.external_cleanup'
ON CONFLICT DO NOTHING;
--> statement-breakpoint
CREATE FUNCTION public.guard_domain_cleanup_reservation() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  IF NEW.hostname IS DISTINCT FROM lower(btrim(NEW.hostname)) OR NEW.hostname !~ '^[a-z0-9][a-z0-9.-]*[a-z0-9]$' THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Domain hostname must be canonical';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('domain-hostname:' || NEW.hostname));
  IF EXISTS (SELECT 1 FROM public.workspace_domain_cleanup_reservations WHERE hostname=NEW.hostname AND released_at IS NULL) THEN
    RAISE EXCEPTION USING ERRCODE='23505',CONSTRAINT='domain_cleanup_reservation_active',MESSAGE='Domain hostname is reserved for cleanup';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.guard_domain_cleanup_reservation() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER guard_domain_cleanup_reservation BEFORE INSERT OR UPDATE OF hostname ON workspace_domains
FOR EACH ROW EXECUTE FUNCTION public.guard_domain_cleanup_reservation();
