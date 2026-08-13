CREATE OR REPLACE FUNCTION public.auth_workspace_access_priority(
  requested_user_id text,
  requested_organization_id text
)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT COALESCE((
    SELECT CASE workspace.access_state
      WHEN 'internal' THEN 0
      WHEN 'active' THEN 1
      WHEN 'trial' THEN 2
      WHEN 'grace' THEN 3
      WHEN 'suspended' THEN 4
      WHEN 'deletion_pending' THEN 5
      ELSE 6
    END
    FROM public.auth_members membership
    INNER JOIN public.workspaces workspace
      ON workspace.auth_organization_id = membership.organization_id
    WHERE membership.user_id = requested_user_id
      AND membership.organization_id = requested_organization_id
    LIMIT 1
  ), 99);
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.auth_workspace_membership_limit(
  requested_user_id text,
  requested_organization_id text
)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT COALESCE((
    SELECT CASE workspace.plan
      WHEN 'internal' THEN 10000
      WHEN 'agency' THEN 15
      WHEN 'studio' THEN 5
      ELSE 1
    END
    FROM public.auth_members membership
    INNER JOIN public.workspaces workspace
      ON workspace.auth_organization_id = membership.organization_id
    WHERE membership.user_id = requested_user_id
      AND membership.organization_id = requested_organization_id
    LIMIT 1
  ), 1);
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.auth_workspace_access_priority(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.auth_workspace_membership_limit(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.auth_workspace_access_priority(text, text) TO yodev_auth;
GRANT EXECUTE ON FUNCTION public.auth_workspace_membership_limit(text, text) TO yodev_auth;
