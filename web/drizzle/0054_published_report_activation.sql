-- Extend the existing database enum-like constraint, preserving the legacy key.
ALTER TABLE activation_milestones
  DROP CONSTRAINT activation_milestones_milestone_check,
  ADD CONSTRAINT activation_milestones_milestone_check CHECK (milestone IN (
    'google_connected','accounts_synced','accounts_selected','first_analysis',
    'first_monitor','first_report','first_report_published','legal_accepted','paid_conversion'
  ));
--> statement-breakpoint
-- Preserve legacy first_report events: they included schedule creation and are
-- not proof of publication. Recover a separate milestone from immutable editions.
INSERT INTO activation_milestones(workspace_id,milestone,actor_user_id,source_entity_id,metadata,occurred_at)
SELECT DISTINCT ON (e.workspace_id) e.workspace_id,'first_report_published','system:activation-backfill',e.id::text,
  jsonb_build_object('shareId',e.share_id,'kind',e.kind,'evidence','report_edition_v1','backfill','0054'),e.generated_at
FROM report_editions e JOIN workspaces w ON w.id=e.workspace_id
WHERE e.generated_at>=w.created_at AND e.generated_at<=now()
ORDER BY e.workspace_id,e.generated_at,e.id
ON CONFLICT (workspace_id,milestone) DO NOTHING;
--> statement-breakpoint
-- A positive explicit selection audit proves an active managed advertiser.
INSERT INTO activation_milestones(workspace_id,milestone,actor_user_id,source_entity_id,metadata,occurred_at)
SELECT DISTINCT ON (a.workspace_id) a.workspace_id,'accounts_selected',a.actor_user_id,a.entity_id::text,
  jsonb_build_object('activeAdvertisers',a.metadata->'activeAdvertisers','evidence','account_selection_audit_v1','backfill','0054'),a.created_at
FROM audit_events a JOIN workspaces w ON w.id=a.workspace_id
WHERE a.action IN ('google_ads.account_selection_saved','google_ads.account_priorities_saved')
  AND a.metadata->>'activeAdvertisers' ~ '^[1-9][0-9]*$'
  AND a.created_at>=w.created_at AND a.created_at<=now()
ORDER BY a.workspace_id,a.created_at,a.id
ON CONFLICT (workspace_id,milestone) DO NOTHING;
