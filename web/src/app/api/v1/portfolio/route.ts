import { apiData, apiError, authenticateApiRequest } from '@/lib/api-v1'
import { getApiPortfolio } from '@/lib/api-v1-repository'

export async function GET(request: Request) {
  const requestId = crypto.randomUUID()
  try {
    const credential = await authenticateApiRequest(request, 'portfolio:read')
    const actorId = `api-key:${credential.key.id}`
    const { accounts, alerts, agents } = await getApiPortfolio({ workspaceId: credential.workspace.id, actorId })
    return apiData({
      workspace: { id: credential.workspace.id, name: credential.workspace.name },
      summary: { accounts: accounts.filter((account) => !account.isManager).length, openAlerts: alerts.count, activeAgents: agents.count },
      accounts,
    }, requestId)
  } catch (error) {
    return apiError(error, requestId)
  }
}
