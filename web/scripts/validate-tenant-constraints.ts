import 'dotenv/config'

import { Pool } from 'pg'

const constraints = [
  ['approval_requests', 'approvals_workspace_client_fk'],
  ['monitoring_agents', 'agents_workspace_client_fk'],
  ['alert_incidents', 'incidents_workspace_agent_fk'],
  ['alert_incidents', 'incidents_workspace_client_fk'],
  ['share_links', 'shares_workspace_client_fk'],
  ['performance_snapshots', 'performance_workspace_client_fk'],
  ['notification_deliveries', 'deliveries_workspace_channel_fk'],
  ['notification_deliveries', 'deliveries_workspace_incident_fk'],
  ['approval_comments', 'comments_workspace_approval_fk'],
  ['client_approval_feedback', 'feedback_workspace_share_fk'],
  ['client_approval_feedback', 'feedback_workspace_approval_fk'],
  ['approval_votes', 'votes_workspace_approval_fk'],
  ['mutation_executions', 'executions_workspace_approval_fk'],
  ['safety_policies', 'safety_workspace_client_fk'],
  ['client_goals', 'goals_workspace_client_fk'],
  ['daily_account_metrics', 'account_metrics_workspace_client_fk'],
  ['daily_campaign_metrics', 'campaign_metrics_workspace_client_fk'],
  ['google_change_events', 'changes_workspace_client_fk'],
  ['google_change_events', 'changes_workspace_audit_fk'],
  ['conversion_action_snapshots', 'conversions_workspace_client_fk'],
  ['job_attempts', 'attempts_workspace_job_fk'],
  ['report_recipients', 'recipients_workspace_share_fk'],
  ['alert_comments', 'alert_comments_workspace_incident_fk'],
  ['offline_conversion_diagnostics', 'offline_diagnostics_workspace_client_fk'],
  ['workspace_tasks', 'workspace_tasks_workspace_client_fk'],
  ['task_comments', 'task_comments_workspace_task_fk'],
  ['report_schedules', 'report_schedules_workspace_client_fk'],
  ['report_schedules', 'report_schedules_workspace_template_fk'],
  ['report_schedules', 'report_schedules_workspace_share_fk'],
  ['support_messages', 'support_messages_workspace_ticket_fk'],
  ['mutation_observations', 'mutation_observations_workspace_approval_fk'],
  ['mutation_observations', 'mutation_observations_workspace_client_fk'],
  ['report_template_versions', 'report_template_versions_workspace_template_fk'],
] as const

async function main() {
  const connectionString = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL
  if (!connectionString) throw new Error('DATABASE_URL_UNPOOLED or DATABASE_URL is required for migration-owner DDL')
  if (process.env.DATABASE_DRIVER === 'node-postgres' && process.env.DATABASE_SYSTEM_URL) {
    const ddlTarget = new URL(connectionString)
    const runtimeTarget = new URL(process.env.DATABASE_SYSTEM_URL)
    const targetIdentity = (url: URL) => `${url.hostname}:${url.port || '5432'}${url.pathname}`
    if (targetIdentity(ddlTarget) !== targetIdentity(runtimeTarget)) {
      throw new Error('DDL and system database URLs target different PostgreSQL databases')
    }
  }
  const pool = new Pool({ connectionString, max: 1 })
  const client = await pool.connect()
  try {
    await client.query('begin')
    for (const [table, constraint] of constraints) {
      if (!/^[a-z_]+$/.test(table) || !/^[a-z_]+$/.test(constraint)) throw new Error('Unsafe SQL identifier')
      await client.query(`alter table ${table} validate constraint ${constraint}`)
    }
    await client.query('commit')
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    client.release()
    await pool.end()
  }
  console.log(JSON.stringify({ validated: constraints.length }))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
