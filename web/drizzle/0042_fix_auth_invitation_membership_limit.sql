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
    FROM public.workspaces workspace
    WHERE workspace.auth_organization_id = requested_organization_id
      AND (
        EXISTS (
          SELECT 1
          FROM public.auth_members membership
          WHERE membership.user_id = requested_user_id
            AND membership.organization_id = requested_organization_id
        )
        OR EXISTS (
          SELECT 1
          FROM public.auth_invitations invitation
          INNER JOIN public.auth_users invited_user
            ON lower(invited_user.email) = lower(invitation.email)
          WHERE invited_user.id = requested_user_id
            AND invitation.organization_id = requested_organization_id
            AND invitation.status = 'pending'
            AND invitation.expires_at > CURRENT_TIMESTAMP
        )
      )
    LIMIT 1
  ), 1);
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.auth_workspace_membership_limit(text, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.auth_workspace_membership_limit(text, text) TO yodev_auth;
