ALTER TABLE "alert_incidents" ADD COLUMN "quality_label" varchar(24);--> statement-breakpoint
ALTER TABLE "alert_incidents" ADD COLUMN "quality_occurrence" integer;--> statement-breakpoint
ALTER TABLE "alert_incidents" ADD COLUMN "quality_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "alert_incidents" ADD COLUMN "quality_reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "alert_incidents" ADD COLUMN "quality_reviewed_by" varchar(64);--> statement-breakpoint
ALTER TABLE public.alert_incidents ADD CONSTRAINT alert_quality_review_check CHECK (
  quality_version >= 0 AND (
    (quality_label IS NULL AND quality_occurrence IS NULL AND quality_reviewed_at IS NULL AND quality_reviewed_by IS NULL)
    OR (quality_label IS NOT NULL AND quality_label IN ('useful','noise','false_positive') AND quality_occurrence IS NOT NULL
      AND quality_occurrence > 0 AND quality_occurrence <= occurrence_count
      AND quality_reviewed_at IS NOT NULL AND quality_reviewed_by IS NOT NULL
      AND length(btrim(quality_reviewed_by)) > 0 AND quality_version > 0)
  )
);
--> statement-breakpoint
-- Expose only the calling tenant's current authorization. Global auth tables remain inaccessible to yodev_app.
CREATE FUNCTION public.lock_workspace_actor(p_workspace_id uuid, p_actor_user_id text)
RETURNS TABLE(state text, plan text, member_role text, is_owner boolean, trial_expired boolean)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  IF p_workspace_id IS NULL OR p_actor_user_id IS NULL OR length(btrim(p_actor_user_id))=0
    OR p_workspace_id IS DISTINCT FROM nullif(current_setting('app.workspace_id',true),'')::uuid
    OR p_actor_user_id IS DISTINCT FROM nullif(current_setting('app.user_id',true),'') THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Workspace actor context mismatch';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext(p_workspace_id::text || ':workspace-access'));
  RETURN QUERY SELECT w.access_state::text,w.plan::text,m.role::text,w.owner_user_id=p_actor_user_id,
    w.access_state='trial' AND w.trial_ends_at IS NOT NULL AND w.trial_ends_at<=current_timestamp
    FROM public.workspaces w JOIN public.auth_members m ON m.organization_id=w.auth_organization_id
    WHERE w.id=p_workspace_id AND m.user_id=p_actor_user_id
    FOR SHARE OF w,m;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.lock_workspace_actor(uuid,text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.lock_workspace_actor(uuid,text) TO yodev_app;
