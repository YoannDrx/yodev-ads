import { Pool } from 'pg'
import { GoogleAdsError, GoogleAdsGateway } from '@/lib/google-ads'

const databaseUrl = process.env.DATABASE_SYSTEM_URL
const workspaceId = process.env.GOOGLE_DRILL_WORKSPACE_ID
if (!databaseUrl) throw new Error('DATABASE_SYSTEM_URL is required')
if (!workspaceId) throw new Error('GOOGLE_DRILL_WORKSPACE_ID is required')

const pool = new Pool({ connectionString: databaseUrl, max: 1, application_name: 'yodev_ads_google_read_drill' })
let stage = 'database_connection'

async function main() {
  const connection = await pool.query<{
    encrypted_refresh_token: string
    manager_customer_id: string
  }>(
    `select encrypted_refresh_token, manager_customer_id
       from google_ads_connections
      where workspace_id = $1 and status = 'active'
      limit 1`,
    [workspaceId],
  )
  const client = await pool.query<{ google_customer_id: string }>(
    `select google_customer_id
       from clients
      where workspace_id = $1 and active = true and is_manager = false
      order by created_at
      limit 1`,
    [workspaceId],
  )
  if (!connection.rows[0]) throw new Error('No active Google Ads connection for the drill workspace')
  if (!client.rows[0]) throw new Error('No active advertiser account for the drill workspace')

  stage = 'oauth_and_mcc'
  const gateway = new GoogleAdsGateway({
    encryptedRefreshToken: connection.rows[0].encrypted_refresh_token,
    managerCustomerId: connection.rows[0].manager_customer_id,
  })
  const customerId = client.rows[0].google_customer_id
  const managed = await gateway.listManagedCustomers()
  stage = 'campaign_performance'
  const campaigns = await gateway.campaignPerformance(customerId)
  stage = 'performance_max'
  const pmaxPlacements = await gateway.performanceMaxPlacements(customerId)
  const assetGroups = await gateway.assetGroupPerformance(customerId)
  stage = 'shopping'
  const shoppingProducts = await gateway.shoppingProductPerformance(customerId)
  stage = 'conversions'
  const conversions = await gateway.conversionActions(customerId)
  stage = 'offline_diagnostics'
  const offlineDiagnostics = await gateway.offlineConversionDiagnostics(customerId)

  process.stdout.write(`${JSON.stringify({
    mode: 'read_only',
    refreshTokenRenewed: true,
    managedAccounts: managed.length,
    campaigns: campaigns.length,
    channelTypes: [...new Set(campaigns.map((campaign) => campaign.channelType))].sort(),
    pmaxPlacements: pmaxPlacements.length,
    assetGroups: assetGroups.length,
    shoppingProducts: shoppingProducts.length,
    conversionActions: conversions.length,
    offlineDiagnostics: offlineDiagnostics.length,
  }, null, 2)}\n`)
}

void main()
  .catch((error) => {
    const safe = error instanceof GoogleAdsError
      ? { kind: 'google_ads', status: error.status, requestId: error.requestId }
      : {
          kind: 'local',
          stage,
          name: error instanceof Error ? error.name : 'UnknownError',
          code: typeof error === 'object' && error && 'code' in error ? String(error.code) : null,
        }
    process.stderr.write(`${JSON.stringify(safe)}\n`)
    process.exitCode = 1
  })
  .finally(() => pool.end())
