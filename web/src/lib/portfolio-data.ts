import 'server-only'

import { eq, sql, type SQL } from 'drizzle-orm'
import { clients, workspaces } from '@/db/schema'
import { withTenantTransaction } from '@/db/transactions'
import { collectionScope, collectionWindow, exactTimestamp, finishCollectionPage, invalidCollectionPage, searchPattern, COLLECTION_PAGE_SIZE } from '@/lib/collection-pagination'
import { workspaceLifecycleAllowsPermission } from '@/lib/workspace-access'
import { readPortfolioCriteria, type PortfolioCriteria } from '@/lib/portfolio-query'

export type PortfolioAccount = {
  id: string; name: string; google_customer_id: string; currency_code: string; timezone: string; at: string;
  period_from: string; period_through: string; observed_days: number; last_observed_at: string | null;
  data_state: 'complete' | 'incomplete' | 'stale'; cost_micros: string | null; clicks: string | null;
  conversions: string | null; conversion_value_micros: string | null; cpa_micros: string | null; roas: string | null;
  monthly_budget_micros: string | null; mtd_cost_micros: string | null; mtd_expected_days: number; mtd_observed_days: number;
  expected_spend_micros: string | null; forecast_micros: string | null; pacing_variance_percent: string | null;
  pacing_state: 'missing_goal' | 'missing_data' | 'under' | 'on_track' | 'over';
  open_alerts: number; critical_alerts: number; open_tasks: number; overdue_tasks: number; blocked_tasks: number; pending_approvals: number; needs_action: boolean;
}
export type PortfolioGroup = { currency_code: string; timezone: string; period_from: string; period_through: string; accounts: number; qualified_accounts: number; cost_micros: string | null; clicks: string | null; conversions: string | null; conversion_value_micros: string | null }
export type PortfolioSummary = { accounts: number; needs_action: number; unqualified: number; critical_alerts: number; overdue_tasks: number; pending_approvals: number }
const emptySummary: PortfolioSummary = { accounts: 0, needs_action: 0, unqualified: 0, critical_alerts: 0, overdue_tasks: 0, pending_approvals: 0 }

/** Complete daily account facts only. Legacy campaign-sum snapshots never establish portfolio totals. */
function portfolioSource(workspaceId: string, observedAt: string, creationBoundary: SQL): SQL {
  return sql`with source as (
    select clients.id, clients.name, clients.google_customer_id, clients.currency_code, clients.timezone, clients.created_at,
      calendar.today-30 as period_from, calendar.today-1 as period_through,
      (extract(day from calendar.today)::int-1) as mtd_expected_days,
      extract(day from (date_trunc('month',calendar.today)+interval '1 month - 1 day'))::int as month_days,
      metrics.observed_days, metrics.last_observed_at,
      case when metrics.observed_days<>30 or metrics.last_observed_at>${observedAt}::timestamptz+interval '60 seconds' then 'incomplete'
        when metrics.last_observed_at is null or metrics.last_observed_at<${observedAt}::timestamptz-interval '26 hours' then 'stale'
        else 'complete' end as data_state,
      metrics.cost_micros as raw_cost, metrics.clicks as raw_clicks, metrics.conversions as raw_conversions, metrics.conversion_value_micros as raw_value,
      metrics.mtd_observed_days, metrics.mtd_cost_micros, goal.monthly_budget_micros,
      alerts.open_alerts, alerts.critical_alerts, tasks.open_tasks, tasks.overdue_tasks, tasks.blocked_tasks, approvals.pending_approvals
    from clients
    cross join lateral (select (${observedAt}::timestamptz at time zone clients.timezone)::date as today) calendar
    left join client_goals goal on goal.workspace_id=clients.workspace_id and goal.client_id=clients.id
    cross join lateral (
      select count(*) filter (where coverage_status='complete' and nullif(btrim(source_version),'') is not null and timezone=clients.timezone and currency_code=clients.currency_code)::int as observed_days,
        max(source_observed_at) filter (where metric_date=(calendar.today-1)::text and coverage_status='complete' and nullif(btrim(source_version),'') is not null and timezone=clients.timezone and currency_code=clients.currency_code) as last_observed_at,
        sum(cost_micros) as cost_micros, sum(clicks) as clicks, sum(conversions) as conversions, sum(conversion_value_micros) as conversion_value_micros,
        count(*) filter (where metric_date>=date_trunc('month',calendar.today)::date::text and coverage_status='complete' and nullif(btrim(source_version),'') is not null and timezone=clients.timezone and currency_code=clients.currency_code)::int as mtd_observed_days,
        sum(cost_micros) filter (where metric_date>=date_trunc('month',calendar.today)::date::text and coverage_status='complete' and nullif(btrim(source_version),'') is not null and timezone=clients.timezone and currency_code=clients.currency_code) as mtd_cost_micros
      from daily_account_metrics where workspace_id=clients.workspace_id and client_id=clients.id and metric_date>=(calendar.today-30)::text and metric_date<calendar.today::text
    ) metrics
    cross join lateral (select count(*)::int as open_alerts, count(*) filter(where severity='critical')::int as critical_alerts
      from alert_incidents where workspace_id=clients.workspace_id and client_id=clients.id and status in ('open','reopened')) alerts
    cross join lateral (select count(*)::int as open_tasks, count(*) filter(where due_at<${observedAt}::timestamptz)::int as overdue_tasks, count(*) filter(where status='blocked')::int as blocked_tasks
      from workspace_tasks where workspace_id=clients.workspace_id and client_id=clients.id and status not in ('done','cancelled')) tasks
    cross join lateral (select count(*)::int as pending_approvals from approval_requests
      where workspace_id=clients.workspace_id and client_id=clients.id and status in ('pending','approved')) approvals
    where clients.workspace_id=${workspaceId} and clients.active=true and clients.is_manager=false and ${creationBoundary}
  ), qualified as (
    select source.*,
      case when data_state='complete' then raw_cost end as cost_micros,
      case when data_state='complete' then raw_clicks end as clicks,
      case when data_state='complete' then raw_conversions end as conversions,
      case when data_state='complete' then raw_value end as conversion_value_micros,
      case when data_state='complete' and raw_conversions>0 then round(raw_cost/raw_conversions) end as cpa_micros,
      case when data_state='complete' and raw_cost>0 then round(raw_value/raw_cost,4) end as roas,
      case when monthly_budget_micros is null or monthly_budget_micros<=0 then 'missing_goal'
        when mtd_expected_days=0 or mtd_observed_days<>mtd_expected_days or last_observed_at is null or last_observed_at<${observedAt}::timestamptz-interval '26 hours' or last_observed_at>${observedAt}::timestamptz+interval '60 seconds' then 'missing_data'
        when mtd_cost_micros*month_days*10<monthly_budget_micros*mtd_expected_days*9 then 'under'
        when mtd_cost_micros*month_days*10>monthly_budget_micros*mtd_expected_days*11 then 'over'
        else 'on_track' end as pacing_state
    from source
  ), portfolio as (
    select qualified.*,
      case when pacing_state in ('under','on_track','over') then round(monthly_budget_micros*mtd_expected_days/month_days) end as expected_spend_micros,
      case when pacing_state in ('under','on_track','over') then round(mtd_cost_micros*month_days/mtd_expected_days) end as forecast_micros,
      case when pacing_state in ('under','on_track','over') then round((mtd_cost_micros*month_days/(monthly_budget_micros*mtd_expected_days)-1)*100,2) end as pacing_variance_percent,
      (critical_alerts>0 or overdue_tasks>0 or blocked_tasks>0 or pending_approvals>0 or data_state<>'complete' or pacing_state in ('under','over','missing_goal','missing_data')) as needs_action
    from qualified
  )`
}

function portfolioFilter(workspaceId: string, query: PortfolioCriteria): SQL {
  const clauses = [sql`true`]
  if (query.q) clauses.push(sql`(clients.name ilike ${searchPattern(query.q)} or clients.google_customer_id ilike ${searchPattern(query.q)})`)
  if (query.currency) clauses.push(sql`clients.currency_code=${query.currency}`)
  if (query.assignee) clauses.push(sql`exists(select 1 from workspace_tasks t where t.workspace_id=${workspaceId} and t.client_id=clients.id and t.status not in ('done','cancelled') and ${query.assignee === 'unassigned' ? sql`t.assigned_to is null` : sql`t.assigned_to=${query.assignee}`})`)
  if (query.attention === 'action') clauses.push(sql`clients.needs_action`)
  if (query.attention === 'critical') clauses.push(sql`clients.critical_alerts>0`)
  if (query.attention === 'missing_data') clauses.push(sql`clients.data_state<>'complete'`)
  if (query.attention === 'overdue') clauses.push(sql`clients.overdue_tasks>0`)
  if (query.attention === 'pending_approval') clauses.push(sql`clients.pending_approvals>0`)
  return sql.join(clauses, sql` and `)
}

export async function getPortfolioSnapshot(workspaceId: string, raw: Record<string, unknown> = {}) {
  const query = readPortfolioCriteria(raw), cursor = typeof raw.cursor === 'string' ? raw.cursor : undefined
  return withTenantTransaction({ workspaceId, userId: 'repository:portfolio' }, async (db) => {
    const workspace = await db.query.workspaces.findFirst({ where: eq(workspaces.id, workspaceId), columns: { accessState: true } })
    if (!workspace || !workspaceLifecycleAllowsPermission(workspace.accessState, 'portfolio:read')) return null
    const window = await collectionWindow(db, collectionScope(workspaceId, 'portfolio', query), { cursor }, clients)
    if (!window) return { query, page: invalidCollectionPage<PortfolioAccount>(), summary: emptySummary, groups: [] as PortfolioGroup[], observedAt: null }
    const observedAt = new Date().toISOString()
    const source = portfolioSource(workspaceId, observedAt, window.boundary), filter = portfolioFilter(workspaceId, query)
    const result = await db.execute<{ summary: PortfolioSummary; groups: PortfolioGroup[]; rows: PortfolioAccount[] }>(sql`${source}
      select
        (select jsonb_build_object('accounts',count(*),'needs_action',count(*) filter(where needs_action),'unqualified',count(*) filter(where data_state<>'complete'),
          'critical_alerts',coalesce(sum(critical_alerts),0),'overdue_tasks',coalesce(sum(overdue_tasks),0),'pending_approvals',coalesce(sum(pending_approvals),0)) from portfolio clients where ${filter}) as summary,
        (select coalesce(jsonb_agg(g order by g.currency_code,g.timezone,g.period_from),'[]'::jsonb) from (
          select currency_code,timezone,period_from::text,period_through::text,count(*)::int as accounts,count(*) filter(where data_state='complete')::int as qualified_accounts,
            sum(cost_micros)::text as cost_micros,sum(clicks)::text as clicks,sum(conversions)::text as conversions,sum(conversion_value_micros)::text as conversion_value_micros
          from portfolio clients where ${filter} group by currency_code,timezone,period_from,period_through
        ) g) as groups,
        (select coalesce(jsonb_agg(p order by p.created_at desc,p.id desc),'[]'::jsonb) from (
          select id,name,google_customer_id,currency_code,timezone,created_at,${exactTimestamp(sql`clients.created_at`)} as at,
            period_from::text,period_through::text,observed_days,last_observed_at,data_state,
            cost_micros::text,clicks::text,conversions::text,conversion_value_micros::text,cpa_micros::text,roas::text,
            monthly_budget_micros::text,case when pacing_state in ('under','on_track','over') then mtd_cost_micros::text end as mtd_cost_micros,
            mtd_expected_days,mtd_observed_days,expected_spend_micros::text,forecast_micros::text,pacing_variance_percent::text,pacing_state,
            open_alerts,critical_alerts,open_tasks,overdue_tasks,blocked_tasks,pending_approvals,needs_action
          from portfolio clients where ${filter} and ${window.after ?? sql`true`} order by created_at desc,id desc limit ${COLLECTION_PAGE_SIZE + 1}
        ) p) as rows
    `)
    const { summary, groups, rows } = result.rows[0]
    return { query, summary, groups, observedAt, page: finishCollectionPage(rows, summary.accounts, window, (row) => row, Boolean(cursor)) }
  })
}
