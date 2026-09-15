-- Evaluate expiry after acquiring row locks, rather than at transaction start.
CREATE OR REPLACE FUNCTION public.lock_workspace_actor(p_workspace_id uuid, p_actor_user_id text)
RETURNS TABLE(state text, plan text, member_role text, is_owner boolean, trial_expired boolean)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE current_actor record;
BEGIN
  IF p_workspace_id IS NULL OR p_actor_user_id IS NULL OR length(btrim(p_actor_user_id))=0
    OR p_workspace_id IS DISTINCT FROM nullif(current_setting('app.workspace_id',true),'')::uuid
    OR p_actor_user_id IS DISTINCT FROM nullif(current_setting('app.user_id',true),'') THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Workspace actor context mismatch';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext(p_workspace_id::text || ':workspace-access'));
  SELECT w.access_state::text AS access_state,w.plan::text AS workspace_plan,m.role::text AS actor_role,
    w.owner_user_id=p_actor_user_id AS actor_is_owner,w.trial_ends_at
    INTO current_actor FROM public.workspaces w JOIN public.auth_members m ON m.organization_id=w.auth_organization_id
    WHERE w.id=p_workspace_id AND m.user_id=p_actor_user_id
    FOR SHARE OF w,m;
  IF NOT FOUND THEN RETURN; END IF;
  RETURN QUERY SELECT current_actor.access_state,current_actor.workspace_plan,current_actor.actor_role,current_actor.actor_is_owner,
    current_actor.access_state='trial' AND current_actor.trial_ends_at IS NOT NULL AND current_actor.trial_ends_at<=clock_timestamp();
END;
$$;
