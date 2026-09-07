-- Keep legacy analysis events: they could be recorded for empty, stale or
-- unqualified collections. Only the new evidence-bearing event is counted.
ALTER TABLE activation_milestones
  DROP CONSTRAINT activation_milestones_milestone_check,
  ADD CONSTRAINT activation_milestones_milestone_check CHECK (milestone IN (
    'google_connected','accounts_synced','accounts_selected','first_analysis',
    'first_qualified_analysis','first_monitor','first_report','first_report_published',
    'legal_accepted','paid_conversion'
  ));
