-- Better Auth counts before creating the membership. Serialize admission at
-- persistence so simultaneous acceptances cannot consume the same final seat.
CREATE FUNCTION public.enforce_workspace_membership_admission()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  workspace_id uuid;
  workspace_state text;
  workspace_plan text;
  trial_end timestamptz;
  member_limit integer;
  member_count integer;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.organization_id = OLD.organization_id THEN
    RETURN NEW;
  END IF;
  SELECT id INTO workspace_id FROM public.workspaces
    WHERE auth_organization_id = NEW.organization_id;
  -- Initial onboarding creates the owner before the mapped workspace in the
  -- same transaction. Generic organization creation is disabled in the app.
  IF workspace_id IS NULL THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtext(workspace_id::text || ':workspace-access'));
  SELECT access_state, plan, trial_ends_at
    INTO workspace_state, workspace_plan, trial_end
    FROM public.workspaces WHERE id = workspace_id FOR SHARE;
  IF NOT FOUND OR workspace_state NOT IN ('internal', 'active', 'trial')
    OR (workspace_state = 'trial' AND trial_end IS NOT NULL AND trial_end <= clock_timestamp()) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Workspace membership admission unavailable';
  END IF;
  IF workspace_state = 'internal' OR workspace_plan = 'internal' THEN RETURN NEW; END IF;
  member_limit := CASE workspace_plan WHEN 'agency' THEN 15 WHEN 'studio' THEN 5 ELSE 1 END;
  SELECT count(*) INTO member_count FROM public.auth_members
    WHERE organization_id = NEW.organization_id;
  IF member_count >= member_limit THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Workspace membership limit reached';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.enforce_workspace_membership_admission() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER workspace_membership_admission
BEFORE INSERT OR UPDATE OF organization_id ON public.auth_members
FOR EACH ROW EXECUTE FUNCTION public.enforce_workspace_membership_admission();
