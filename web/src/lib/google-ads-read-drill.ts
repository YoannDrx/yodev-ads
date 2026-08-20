import 'server-only'

import { and, eq } from 'drizzle-orm'
import { clients, googleAdsConnections, workspaces } from '@/db/schema'
import { withSystemTransaction } from '@/db/transactions'
import { GoogleAdsError, GoogleAdsGateway } from '@/lib/google-ads'

const stages = [
  'oauth_and_mcc',
  'campaign_performance',
  'performance_max',
  'shopping',
  'conversions',
  'offline_diagnostics',
] as const

type GoogleAdsReadStage = typeof stages[number] | 'database_context'

type DrillContext = {
  encryptedRefreshToken: string
  managerCustomerId: string
  googleCustomerId: string
}

type DrillGateway = Pick<GoogleAdsGateway,
  | 'verifyOAuthAccess'
  | 'listManagedCustomers'
  | 'campaignPerformance'
  | 'performanceMaxPlacements'
  | 'assetGroupPerformance'
  | 'shoppingProductPerformance'
  | 'conversionActions'
  | 'offlineConversionDiagnostics'
  | 'collectedRequestIds'
>

type DrillDependencies = {
  loadContext: () => Promise<DrillContext>
  createGateway: (context: DrillContext) => DrillGateway
}

export class GoogleAdsReadDrillError extends Error {
  constructor(
    readonly code: string,
    readonly stage: GoogleAdsReadStage,
    readonly requestId: string | null = null,
  ) {
    super(code)
    this.name = 'GoogleAdsReadDrillError'
  }
}

async function loadContext(): Promise<DrillContext> {
  return withSystemTransaction(async (db) => {
    const connections = await db
      .select({
        workspaceId: googleAdsConnections.workspaceId,
        encryptedRefreshToken: googleAdsConnections.encryptedRefreshToken,
        managerCustomerId: googleAdsConnections.managerCustomerId,
      })
      .from(googleAdsConnections)
      .innerJoin(workspaces, eq(workspaces.id, googleAdsConnections.workspaceId))
      .where(and(eq(workspaces.accessState, 'internal'), eq(googleAdsConnections.status, 'active')))
      .orderBy(googleAdsConnections.createdAt)
      .limit(2)

    if (connections.length === 0) {
      throw new GoogleAdsReadDrillError('connection_missing', 'database_context')
    }
    if (connections.length !== 1) {
      throw new GoogleAdsReadDrillError('connection_ambiguous', 'database_context')
    }

    const [advertiser] = await db
      .select({ googleCustomerId: clients.googleCustomerId })
      .from(clients)
      .where(and(
        eq(clients.workspaceId, connections[0].workspaceId),
        eq(clients.active, true),
        eq(clients.isManager, false),
      ))
      .orderBy(clients.createdAt)
      .limit(1)

    if (!advertiser) {
      throw new GoogleAdsReadDrillError('advertiser_missing', 'database_context')
    }
    return { ...connections[0], googleCustomerId: advertiser.googleCustomerId }
  })
}

const defaultDependencies: DrillDependencies = {
  loadContext,
  createGateway: (context) => new GoogleAdsGateway({
    encryptedRefreshToken: context.encryptedRefreshToken,
    managerCustomerId: context.managerCustomerId,
  }),
}

export async function runGoogleAdsReadDrill(dependencies: DrillDependencies = defaultDependencies) {
  let stage: GoogleAdsReadStage = 'database_context'
  try {
    const context = await dependencies.loadContext()
    const gateway = dependencies.createGateway(context)
    const requestIds = Object.fromEntries(stages.map((name) => [name, [] as string[]])) as Record<typeof stages[number], string[]>

    const read = async <T>(name: typeof stages[number], operation: () => Promise<T>) => {
      stage = name
      const offset = gateway.collectedRequestIds().length
      const result = await operation()
      requestIds[name] = gateway.collectedRequestIds().slice(offset)
      return result
    }

    await gateway.verifyOAuthAccess()
    const managed = await read('oauth_and_mcc', () => gateway.listManagedCustomers())
    const campaigns = await read('campaign_performance', () => gateway.campaignPerformance(context.googleCustomerId))
    const [pmaxPlacements, assetGroups] = await read('performance_max', () => Promise.all([
      gateway.performanceMaxPlacements(context.googleCustomerId),
      gateway.assetGroupPerformance(context.googleCustomerId),
    ]))
    const shoppingProducts = await read('shopping', () => gateway.shoppingProductPerformance(context.googleCustomerId))
    const conversions = await read('conversions', () => gateway.conversionActions(context.googleCustomerId))
    const offlineDiagnostics = await read('offline_diagnostics', () => gateway.offlineConversionDiagnostics(context.googleCustomerId))

    return {
      verified: true as const,
      mode: 'read_only' as const,
      refreshTokenRenewed: true,
      managedAccounts: managed.length,
      campaigns: campaigns.length,
      channelTypes: [...new Set(campaigns.map((campaign) => campaign.channelType))].sort(),
      pmaxPlacements: pmaxPlacements.length,
      assetGroups: assetGroups.length,
      shoppingProducts: shoppingProducts.length,
      conversionActions: conversions.length,
      offlineDiagnostics: offlineDiagnostics.length,
      requestIds,
    }
  } catch (error) {
    if (error instanceof GoogleAdsReadDrillError) throw error
    if (error instanceof GoogleAdsError) {
      throw new GoogleAdsReadDrillError('google_ads_request_failed', stage, error.requestId)
    }
    throw new GoogleAdsReadDrillError('read_drill_failed', stage)
  }
}
