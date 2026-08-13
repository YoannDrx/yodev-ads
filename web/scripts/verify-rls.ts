import 'dotenv/config'

import { and, eq, inArray, ne, sql } from 'drizzle-orm'
import { auditEvents, clients, notificationOAuthSessions, workspaces } from '../src/db/schema'
import { withSystemTransaction, withTenantTransaction } from '../src/db/transactions'

async function main() {
  const expectedTenantTables = [
    'workspaces', 'google_ads_connections', 'clients', 'approval_requests', 'audit_events',
    'usage_snapshots', 'monitoring_agents', 'alert_incidents', 'alert_comments', 'share_links',
    'api_keys', 'rate_limit_buckets', 'secret_revelations', 'performance_snapshots',
    'notification_channels', 'notification_oauth_sessions', 'notification_deliveries', 'approval_comments',
    'client_approval_feedback', 'trial_grants', 'legal_acceptances', 'approval_votes',
    'mutation_executions', 'safety_policies', 'client_goals', 'daily_account_metrics',
    'daily_campaign_metrics', 'google_change_events', 'conversion_action_snapshots', 'jobs',
    'job_attempts', 'export_jobs', 'deletion_requests', 'report_recipients', 'workspace_domains',
    'offline_conversion_diagnostics', 'workspace_tasks', 'task_comments', 'report_templates',
    'report_schedules', 'member_notification_preferences', 'activation_milestones',
    'support_tickets', 'support_messages',
    'mutation_observations', 'report_template_versions',
  ] as const

  const securityMetadata = await withSystemTransaction(async (db) => {
    const tableResult = await db.execute<{ table_name: string; rls: boolean; force_rls: boolean }>(sql`
      select c.relname as table_name, c.relrowsecurity as rls, c.relforcerowsecurity as force_rls
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname in (${sql.join(expectedTenantTables.map((table) => sql`${table}`), sql`, `)})
    `)
    const roleResult = await db.execute<{ rolname: string; rolbypassrls: boolean }>(sql`
      select rolname, rolbypassrls from pg_roles
      where rolname in ('yodev_app', 'yodev_system', 'yodev_purge', 'yodev_auth')
    `)
    const privilegeResult = await db.execute<{ can_update: boolean; can_delete: boolean; can_truncate: boolean }>(sql`
      select
        has_table_privilege('yodev_app', 'public.audit_events', 'UPDATE') as can_update,
        has_table_privilege('yodev_app', 'public.audit_events', 'DELETE') as can_delete,
        has_table_privilege('yodev_app', 'public.audit_events', 'TRUNCATE') as can_truncate
    `)
    const authPrivilegeResult = await db.execute<{
      auth_select: boolean
      auth_insert: boolean
      app_auth_select: boolean
      auth_workspace_select: boolean
      auth_workspace_mapping_select: boolean
      auth_workspace_plan_select: boolean
    }>(sql`
      select
        has_table_privilege('yodev_auth', 'public.auth_users', 'SELECT') as auth_select,
        has_table_privilege('yodev_auth', 'public.auth_users', 'INSERT') as auth_insert,
        has_table_privilege('yodev_app', 'public.auth_users', 'SELECT') as app_auth_select,
        has_table_privilege('yodev_auth', 'public.workspaces', 'SELECT') as auth_workspace_select,
        has_column_privilege('yodev_auth', 'public.workspaces', 'auth_organization_id', 'SELECT') as auth_workspace_mapping_select,
        has_column_privilege('yodev_auth', 'public.workspaces', 'plan', 'SELECT') as auth_workspace_plan_select
    `)
    const supportPrivilegeResult = await db.execute<{
      message_delete: boolean
      ticket_delete: boolean
      platform_select: boolean
      ticket_assign: boolean
      ticket_status: boolean
      observation_update: boolean
      observation_delete: boolean
      template_version_update: boolean
      template_version_delete: boolean
      subprocessor_app_select: boolean
      subprocessor_purge_select: boolean
      subprocessor_system_select: boolean
    }>(sql`
      select
        has_table_privilege('yodev_app', 'public.support_messages', 'DELETE') as message_delete,
        has_table_privilege('yodev_app', 'public.support_tickets', 'DELETE') as ticket_delete,
        has_table_privilege('yodev_app', 'public.platform_incidents', 'SELECT') as platform_select,
        has_column_privilege('yodev_app', 'public.support_tickets', 'assigned_to', 'UPDATE') as ticket_assign,
        has_column_privilege('yodev_app', 'public.support_tickets', 'status', 'UPDATE') as ticket_status,
        has_table_privilege('yodev_app', 'public.mutation_observations', 'UPDATE') as observation_update,
        has_table_privilege('yodev_app', 'public.mutation_observations', 'DELETE') as observation_delete,
        has_table_privilege('yodev_app', 'public.report_template_versions', 'UPDATE') as template_version_update,
        has_table_privilege('yodev_app', 'public.report_template_versions', 'DELETE') as template_version_delete,
        has_table_privilege('yodev_app', 'public.subprocessor_change_notices', 'SELECT') as subprocessor_app_select,
        has_table_privilege('yodev_purge', 'public.subprocessor_change_notices', 'SELECT') as subprocessor_purge_select,
        has_table_privilege('yodev_system', 'public.subprocessor_change_notices', 'SELECT') as subprocessor_system_select
    `)
    const supportPolicyResult = await db.execute<{ qual: string | null }>(sql`
      select qual from pg_policies
      where schemaname = 'public' and tablename = 'support_messages' and policyname = 'support_messages_app_select'
    `)
    const oauthSessionPolicyResult = await db.execute<{ policyname: string; cmd: string; qual: string | null; with_check: string | null }>(sql`
      select policyname, cmd, qual, with_check from pg_policies
      where schemaname = 'public' and tablename = 'notification_oauth_sessions' and roles @> array['yodev_app']::name[]
    `)
    return {
      tables: tableResult.rows,
      roles: roleResult.rows,
      auditPrivileges: privilegeResult.rows[0],
      authPrivileges: authPrivilegeResult.rows[0],
      supportPrivileges: supportPrivilegeResult.rows[0],
      supportSelectPolicy: supportPolicyResult.rows[0]?.qual ?? null,
      oauthSessionPolicies: oauthSessionPolicyResult.rows,
    }
  })
  const metadataByTable = new Map(securityMetadata.tables.map((table) => [table.table_name, table]))
  const insecureTables = expectedTenantTables.filter((table) => {
    const metadata = metadataByTable.get(table)
    return !metadata?.rls || !metadata.force_rls
  })
  if (insecureTables.length > 0) throw new Error(`RLS/FORCE RLS missing: ${insecureTables.join(', ')}`)
  if (securityMetadata.roles.length !== 4 || securityMetadata.roles.some((role) => role.rolbypassrls)) {
    throw new Error('A runtime database role is missing or has BYPASSRLS')
  }
  if (!securityMetadata.authPrivileges?.auth_select ||
      !securityMetadata.authPrivileges?.auth_insert ||
      securityMetadata.authPrivileges?.app_auth_select ||
      securityMetadata.authPrivileges?.auth_workspace_select ||
      !securityMetadata.authPrivileges?.auth_workspace_mapping_select ||
      !securityMetadata.authPrivileges?.auth_workspace_plan_select) {
    throw new Error('Better Auth database role privileges are unsafe')
  }
  if (securityMetadata.auditPrivileges?.can_update || securityMetadata.auditPrivileges?.can_delete || securityMetadata.auditPrivileges?.can_truncate) {
    throw new Error('Application role has destructive audit privileges')
  }
  if (securityMetadata.supportPrivileges?.message_delete || securityMetadata.supportPrivileges?.ticket_delete) {
    throw new Error('Application role has destructive support privileges')
  }
  if (securityMetadata.supportPrivileges?.platform_select) {
    throw new Error('Application role can read global platform incidents')
  }
  if (securityMetadata.supportPrivileges?.ticket_assign || !securityMetadata.supportPrivileges?.ticket_status) {
    throw new Error('Application support-ticket column privileges are unsafe')
  }
  if (securityMetadata.supportPrivileges?.observation_update || securityMetadata.supportPrivileges?.observation_delete) {
    throw new Error('Application role can alter mutation observations')
  }
  if (securityMetadata.supportPrivileges?.template_version_update || securityMetadata.supportPrivileges?.template_version_delete) {
    throw new Error('Application role can alter report template history')
  }
  if (securityMetadata.supportPrivileges?.subprocessor_app_select ||
      securityMetadata.supportPrivileges?.subprocessor_purge_select ||
      !securityMetadata.supportPrivileges?.subprocessor_system_select) {
    throw new Error('Subprocessor change notices are not restricted to the system role')
  }
  if (!securityMetadata.supportSelectPolicy?.includes('internal')) {
    throw new Error('Support message RLS does not hide internal notes')
  }
  const oauthPolicies = new Map(securityMetadata.oauthSessionPolicies.map((policy) => [policy.cmd, policy]))
  if (!oauthPolicies.get('SELECT')?.qual?.includes('user_id') ||
      !oauthPolicies.get('INSERT')?.with_check?.includes('user_id') ||
      !oauthPolicies.get('UPDATE')?.qual?.includes('user_id') ||
      !oauthPolicies.get('DELETE')?.qual?.includes('user_id')) {
    throw new Error('Notification OAuth session policies do not enforce actor-bound application access')
  }

  const fixtureIds = [
    '10000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000002',
  ]
  const fixtures = await withSystemTransaction((db) => db
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(inArray(workspaces.id, fixtureIds))
    .orderBy(workspaces.id))
  if (fixtures.length < 2) throw new Error('RLS verification requires two staging workspaces')
  const [tenantA, tenantB] = fixtures

  const visibleWithoutContext = await withTenantTransaction(
    { workspaceId: '00000000-0000-0000-0000-000000000000', userId: 'system:rls-verifier' },
    (db) => db.select({ id: workspaces.id }).from(workspaces),
  )
  if (visibleWithoutContext.length !== 0) throw new Error('An unknown tenant context can read workspace rows')

  const visible = await withTenantTransaction(
    { workspaceId: tenantA.id, userId: 'system:rls-verifier' },
    (db) => db.select({ workspaceId: clients.workspaceId }).from(clients),
  )
  if (visible.some((row) => row.workspaceId !== tenantA.id)) throw new Error('RLS leaked a client from another tenant')

  const hiddenB = await withTenantTransaction(
    { workspaceId: tenantA.id, userId: 'system:rls-verifier' },
    (db) => db.select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.id, tenantB.id)),
  )
  if (hiddenB.length !== 0) throw new Error('RLS exposed workspace B while scoped to A')

  let crossTenantWriteBlocked = false
  try {
    const changed = await withTenantTransaction(
      { workspaceId: tenantA.id, userId: 'system:rls-verifier' },
      (db) => db
        .update(clients)
        .set({ updatedAt: new Date() })
        .where(and(eq(clients.workspaceId, tenantB.id), ne(clients.workspaceId, tenantA.id)))
        .returning({ id: clients.id }),
    )
    // RLS can safely turn the write into a zero-row update.
    crossTenantWriteBlocked = changed.length === 0
  } catch {
    crossTenantWriteBlocked = true
  }
  if (!crossTenantWriteBlocked) throw new Error('Cross-tenant write was not blocked')

  const [audit] = await withSystemTransaction((db) => db
    .select({ id: auditEvents.id })
    .from(auditEvents)
    .where(eq(auditEvents.workspaceId, tenantA.id))
    .limit(1))
  if (audit) {
    let immutable = false
    try {
      await withTenantTransaction(
        { workspaceId: tenantA.id, userId: 'system:rls-verifier' },
        (db) => db.update(auditEvents).set({ actorUserId: 'tampered' }).where(eq(auditEvents.id, audit.id)),
      )
    } catch {
      immutable = true
    }
    if (!immutable) throw new Error('Application role can mutate audit events')
  }

  const oauthSessionIds = [
    '30000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000002',
    '30000000-0000-4000-8000-000000000003',
  ]
  await withSystemTransaction(async (db) => {
    await db.delete(notificationOAuthSessions).where(inArray(notificationOAuthSessions.id, oauthSessionIds))
    await db.insert(notificationOAuthSessions).values([
      {
        id: oauthSessionIds[0], workspaceId: tenantA.id, userId: 'rls-oauth-user-a', provider: 'teams',
        encryptedRefreshToken: 'encrypted-a', expiresAt: new Date(Date.now() + 15 * 60_000),
      },
      {
        id: oauthSessionIds[1], workspaceId: tenantA.id, userId: 'rls-oauth-user-b', provider: 'teams',
        encryptedRefreshToken: 'encrypted-b', expiresAt: new Date(Date.now() + 15 * 60_000),
      },
      {
        id: oauthSessionIds[2], workspaceId: tenantB.id, userId: 'rls-oauth-user-c', provider: 'teams',
        encryptedRefreshToken: 'encrypted-c', expiresAt: new Date(Date.now() + 15 * 60_000),
      },
    ])
  })
  try {
    const visibleOAuthSessions = await withTenantTransaction(
      { workspaceId: tenantA.id, userId: 'rls-oauth-user-a' },
      (db) => db.select({ id: notificationOAuthSessions.id }).from(notificationOAuthSessions),
    )
    if (visibleOAuthSessions.length !== 1 || visibleOAuthSessions[0].id !== oauthSessionIds[0]) {
      throw new Error('Application role can read another actor OAuth session')
    }
    const forbiddenDelete = await withTenantTransaction(
      { workspaceId: tenantA.id, userId: 'rls-oauth-user-a' },
      (db) => db.delete(notificationOAuthSessions).where(eq(notificationOAuthSessions.id, oauthSessionIds[1])).returning({ id: notificationOAuthSessions.id }),
    )
    if (forbiddenDelete.length !== 0) throw new Error('Application role can revoke another actor OAuth session')
    const systemRevoked = await withSystemTransaction((db) => db.delete(notificationOAuthSessions).where(
      eq(notificationOAuthSessions.workspaceId, tenantA.id),
    ).returning({ id: notificationOAuthSessions.id }))
    if (systemRevoked.length !== 2) throw new Error('System role cannot revoke every OAuth session in a tenant')
    const tenantBSession = await withSystemTransaction((db) => db.select({ id: notificationOAuthSessions.id }).from(
      notificationOAuthSessions,
    ).where(eq(notificationOAuthSessions.id, oauthSessionIds[2])))
    if (tenantBSession.length !== 1) throw new Error('System OAuth revocation crossed the tenant boundary')
  } finally {
    await withSystemTransaction((db) => db.delete(notificationOAuthSessions).where(inArray(
      notificationOAuthSessions.id,
      oauthSessionIds,
    )))
  }

  await withSystemTransaction((db) => db.delete(workspaces).where(inArray(workspaces.id, fixtureIds)))

  console.log(JSON.stringify({
    ok: true,
    tenantA: tenantA.id,
    tenantB: tenantB.id,
    visibleClientRows: visible.length,
    rlsTables: expectedTenantTables.length,
    runtimeRoles: securityMetadata.roles.map((role) => role.rolname),
    oauthSessionIsolation: true,
  }))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
