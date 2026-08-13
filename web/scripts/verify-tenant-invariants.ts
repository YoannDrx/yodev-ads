import { sql } from 'drizzle-orm'
import { withSystemTransaction } from '../src/db/transactions'

type InvariantRow = { invariant: string; violations: number }

async function main() {
  const rows = await withSystemTransaction(async (transaction) => {
    const result = await transaction.execute<InvariantRow>(sql`
    select 'workspace_state' as invariant, count(*)::int as violations
      from workspaces where access_state is null
    union all
    select 'duplicate_stripe_subscription', count(*)::int
      from (select stripe_subscription_id from workspaces where stripe_subscription_id is not null group by 1 having count(*) > 1) duplicates
    union all
    select 'approval_client_tenant', count(*)::int
      from approval_requests child join clients parent on parent.id = child.client_id
      where child.workspace_id <> parent.workspace_id
    union all
    select 'agent_client_tenant', count(*)::int
      from monitoring_agents child join clients parent on parent.id = child.client_id
      where child.workspace_id <> parent.workspace_id
    union all
    select 'incident_client_tenant', count(*)::int
      from alert_incidents child join clients parent on parent.id = child.client_id
      where child.workspace_id <> parent.workspace_id
    union all
    select 'share_client_tenant', count(*)::int
      from share_links child join clients parent on parent.id = child.client_id
      where child.workspace_id <> parent.workspace_id
    union all
    select 'performance_client_tenant', count(*)::int
      from performance_snapshots child join clients parent on parent.id = child.client_id
      where child.workspace_id <> parent.workspace_id
    union all
    select 'support_message_ticket_tenant', count(*)::int
      from support_messages child join support_tickets parent on parent.id = child.ticket_id
      where child.workspace_id <> parent.workspace_id
    union all
    select 'mutation_observation_approval_tenant', count(*)::int
      from mutation_observations child join approval_requests parent on parent.id = child.approval_id
      where child.workspace_id <> parent.workspace_id
    union all
    select 'mutation_observation_client_tenant', count(*)::int
      from mutation_observations child join clients parent on parent.id = child.client_id
      where child.workspace_id <> parent.workspace_id
    union all
    select 'report_template_version_tenant', count(*)::int
      from report_template_versions child join report_templates parent on parent.id = child.template_id
      where child.workspace_id <> parent.workspace_id
    union all
    select 'legacy_workspace_auth_mapping', count(*)::int
      from workspaces
      where clerk_organization_id is not null and auth_organization_id is null
    union all
    select 'workspace_owner_membership', count(*)::int
      from workspaces workspace
      where workspace.auth_organization_id is not null
        and not exists (
          select 1 from auth_members member
          where member.organization_id = workspace.auth_organization_id
            and member.user_id = workspace.auth_owner_user_id
            and member.role = 'owner'
        )
    union all
    select 'trial_grant_auth_mapping', count(*)::int
      from trial_grants grant_row
      where grant_row.creator_clerk_user_id is not null and grant_row.creator_auth_user_id is null
    union all
    select 'auth_organization_workspace_uniqueness', count(*)::int
      from (
        select auth_organization_id from workspaces
        where auth_organization_id is not null
        group by auth_organization_id having count(*) > 1
      ) duplicates
    `)
    return result.rows
  })

  const failed = rows.filter((row) => Number(row.violations) > 0)
  console.log(JSON.stringify({ ok: failed.length === 0, invariants: rows }, null, 2))
  if (failed.length > 0) process.exitCode = 1
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
