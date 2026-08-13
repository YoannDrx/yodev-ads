import 'server-only'

import { and, asc, count, eq, gte, isNull, lte, or, sum } from 'drizzle-orm'
import { clients, dailyAccountMetrics, safetyPolicies, workspaces } from '@/db/schema'
import { withTenantTransaction, type DatabaseTransaction } from '@/db/transactions'

export type BudgetPolicy = {
  currencyCode: string
  maximumDailyBudgetMicros: string | null
  maximumMonthlySpendMicros: string | null
  maximumVariationPercent: string | null
}

export function calendarPeriodAt(date: Date, timezone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date).map((part) => [part.type, part.value]),
  )
  const through = `${parts.year}-${parts.month}-${parts.day}`
  return { month: `${parts.year}-${parts.month}`, from: `${parts.year}-${parts.month}-01`, through }
}

export function evaluateBudgetPolicy(input: {
  policy: BudgetPolicy
  currencyCode: string
  currentBudgetMicros: bigint
  proposedBudgetMicros: bigint
  monthSpendMicros?: bigint
}) {
  if (input.policy.currencyCode !== input.currencyCode) {
    throw new Error(`La règle de sécurité est en ${input.policy.currencyCode}, mais le compte est en ${input.currencyCode}.`)
  }
  if (
    input.policy.maximumDailyBudgetMicros &&
    input.proposedBudgetMicros > BigInt(input.policy.maximumDailyBudgetMicros)
  ) {
    throw new Error('Ce budget dépasse la limite quotidienne définie dans les règles de sécurité.')
  }
  if (input.policy.maximumVariationPercent && input.currentBudgetMicros > BigInt(0)) {
    const variationBasisPoints = (
      (input.proposedBudgetMicros > input.currentBudgetMicros
        ? input.proposedBudgetMicros - input.currentBudgetMicros
        : input.currentBudgetMicros - input.proposedBudgetMicros) * BigInt(10_000)
    ) / input.currentBudgetMicros
    const maximumBasisPoints = BigInt(Math.round(Number(input.policy.maximumVariationPercent) * 100))
    if (variationBasisPoints > maximumBasisPoints) {
      throw new Error('La variation de budget dépasse le pourcentage autorisé par les règles de sécurité.')
    }
  }
  if (input.policy.maximumMonthlySpendMicros) {
    if (input.monthSpendMicros === undefined) {
      throw new Error('Le plafond mensuel ne peut pas être vérifié car les métriques journalières sont indisponibles.')
    }
    if (
      input.proposedBudgetMicros > input.currentBudgetMicros &&
      input.monthSpendMicros >= BigInt(input.policy.maximumMonthlySpendMicros)
    ) {
      throw new Error('Le plafond de dépense du mois calendaire est atteint. Les hausses de budget sont bloquées.')
    }
  }
}

type Workspace = typeof workspaces.$inferSelect
type Client = typeof clients.$inferSelect

export async function assertBudgetChangeSafety(input: {
  workspace: Workspace
  client: Client
  campaignId: string
  currentBudgetMicros: string
  proposedBudgetMicros: string
  now?: Date
}) {
  return withTenantTransaction(
    { workspaceId: input.workspace.id, userId: 'repository:budget-safety' },
    (db) => assertBudgetChangeSafetyWithDatabase(db, input),
  )
}

export async function assertBudgetChangeSafetyWithDatabase(db: DatabaseTransaction, input: {
  workspace: Workspace
  client: Client
  campaignId: string
  currentBudgetMicros: string
  proposedBudgetMicros: string
  now?: Date
}) {
  const candidates = await db
    .select()
    .from(safetyPolicies)
    .where(
      and(
        eq(safetyPolicies.workspaceId, input.workspace.id),
        eq(safetyPolicies.enabled, true),
        or(isNull(safetyPolicies.clientId), eq(safetyPolicies.clientId, input.client.id)),
        or(isNull(safetyPolicies.campaignId), eq(safetyPolicies.campaignId, input.campaignId)),
      ),
    )
    .orderBy(asc(safetyPolicies.createdAt))

  const scoped =
    candidates.find((policy) => policy.clientId === input.client.id && policy.campaignId === input.campaignId) ??
    candidates.find((policy) => policy.clientId === input.client.id && policy.campaignId === null) ??
    candidates.find((policy) => policy.clientId === null && policy.campaignId === null)

  const legacyPolicy = input.workspace.maximumDailyBudgetMicros || input.workspace.maximumMonthlySpendMicros
    ? {
        currencyCode: input.client.currencyCode,
        maximumDailyBudgetMicros: input.workspace.maximumDailyBudgetMicros,
        maximumMonthlySpendMicros: input.workspace.maximumMonthlySpendMicros,
        maximumVariationPercent: null,
      }
    : null
  const policy = scoped ?? legacyPolicy
  if (!policy) return { applied: false as const }

  let monthSpendMicros: bigint | undefined
  if (policy.maximumMonthlySpendMicros) {
    const period = calendarPeriodAt(input.now ?? new Date(), input.client.timezone)
    const [metrics] = await db
      .select({ count: count(), spend: sum(dailyAccountMetrics.costMicros) })
      .from(dailyAccountMetrics)
      .where(
        and(
          eq(dailyAccountMetrics.workspaceId, input.workspace.id),
          eq(dailyAccountMetrics.clientId, input.client.id),
          gte(dailyAccountMetrics.metricDate, period.from),
          lte(dailyAccountMetrics.metricDate, period.through),
        ),
      )
    if (metrics.count > 0) monthSpendMicros = BigInt(metrics.spend ?? '0')
  }
  evaluateBudgetPolicy({
    policy,
    currencyCode: input.client.currencyCode,
    currentBudgetMicros: BigInt(input.currentBudgetMicros),
    proposedBudgetMicros: BigInt(input.proposedBudgetMicros),
    monthSpendMicros,
  })
  return { applied: true as const, policyId: scoped?.id ?? 'legacy_workspace' }
}
