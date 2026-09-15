import 'server-only'

import { and, eq, inArray, sql } from 'drizzle-orm'
import { workspaces } from '@/db/schema'
import { withTenantTransaction } from '@/db/transactions'
import { LEGAL_VERSIONS } from '@/lib/legal'

/** Current setup and qualified historical milestones; never loads provider credentials or report tokens. */
export function getGettingStartedEvidence(workspaceId: string, userId: string) {
  return withTenantTransaction({ workspaceId, userId }, async (db) => {
    // Explicit outer identifiers avoid single-table projection dequalification inside correlated subqueries.
    const [evidence] = await db.select({
      connected: sql<boolean>`exists(select 1 from google_ads_connections g where g.workspace_id=workspaces.id and g.status='active')`,
      hasAdvertiser: sql<boolean>`exists(select 1 from clients c where c.workspace_id=workspaces.id and c.active and not c.is_manager)`,
      selectedClientId: sql<string | null>`(select c.id from clients c where c.workspace_id=workspaces.id and c.active and not c.is_manager and c.managed_selected order by c.name,c.id limit 1)`,
      hasGoal: sql<boolean>`exists(select 1 from client_goals g join clients c on c.id=g.client_id and c.workspace_id=g.workspace_id where g.workspace_id=workspaces.id and c.active and not c.is_manager and c.managed_selected)`,
      monitorEnabled: sql<boolean>`exists(select 1 from monitoring_agents a where a.workspace_id=workspaces.id and a.enabled and exists(select 1 from clients c where c.workspace_id=a.workspace_id and c.active and not c.is_manager and c.managed_selected and (a.client_id is null or a.client_id=c.id)))`,
      hasAnalysis: sql<boolean>`exists(select 1 from activation_milestones a where a.workspace_id=workspaces.id and a.milestone='first_qualified_analysis' and a.occurred_at>=workspaces.created_at and a.occurred_at<=now())`,
      hasPublishedReport: sql<boolean>`exists(select 1 from activation_milestones a where a.workspace_id=workspaces.id and a.milestone='first_report_published' and a.occurred_at>=workspaces.created_at and a.occurred_at<=now())`,
      legalAccepted: sql<boolean>`exists(select 1 from legal_acceptances a where a.workspace_id=workspaces.id and a.terms_version=${LEGAL_VERSIONS.terms} and a.privacy_version=${LEGAL_VERSIONS.privacy} and a.dpa_version=${LEGAL_VERSIONS.dpa} and a.context='checkout_business' and a.accepted_at>=workspaces.created_at and a.accepted_at<=now())`,
    }).from(workspaces).where(and(eq(workspaces.id, workspaceId), inArray(workspaces.accessState, ['active', 'trial', 'internal', 'grace']))).limit(1)
    return evidence ?? null
  })
}

export type GettingStartedEvidence = NonNullable<Awaited<ReturnType<typeof getGettingStartedEvidence>>>
