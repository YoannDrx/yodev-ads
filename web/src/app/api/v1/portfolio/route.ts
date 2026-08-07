import { and, count, eq, isNull } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { getDb } from '@/db'
import { alertIncidents, apiKeys, clients, monitoringAgents, workspaces } from '@/db/schema'
import { hashToken } from '@/lib/tokens'

export async function GET(request: Request) {
  const authorization = request.headers.get('authorization')
  const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : ''
  if (!token.startsWith('ya_live_')) return NextResponse.json({ error: 'Invalid API key' }, { status: 401 })

  const db = getDb()
  const [credential] = await db
    .select({ key: apiKeys, workspace: workspaces })
    .from(apiKeys)
    .innerJoin(workspaces, eq(workspaces.id, apiKeys.workspaceId))
    .where(and(eq(apiKeys.tokenHash, hashToken(token)), isNull(apiKeys.revokedAt)))
    .limit(1)
  if (!credential) return NextResponse.json({ error: 'Invalid API key' }, { status: 401 })

  const [accounts, [alerts], [agents]] = await Promise.all([
    db.query.clients.findMany({
      where: and(eq(clients.workspaceId, credential.workspace.id), eq(clients.active, true)),
      columns: {
        id: true,
        googleCustomerId: true,
        name: true,
        currencyCode: true,
        timezone: true,
        isManager: true,
      },
      orderBy: [clients.name],
    }),
    db
      .select({ count: count() })
      .from(alertIncidents)
      .where(and(eq(alertIncidents.workspaceId, credential.workspace.id), eq(alertIncidents.status, 'open'))),
    db
      .select({ count: count() })
      .from(monitoringAgents)
      .where(and(eq(monitoringAgents.workspaceId, credential.workspace.id), eq(monitoringAgents.enabled, true))),
  ])
  await db
    .update(apiKeys)
    .set({ lastUsedAt: new Date(), updatedAt: new Date() })
    .where(eq(apiKeys.id, credential.key.id))

  return NextResponse.json({
    data: {
      workspace: { id: credential.workspace.id, name: credential.workspace.name },
      summary: {
        accounts: accounts.filter((account) => !account.isManager).length,
        openAlerts: alerts.count,
        activeAgents: agents.count,
      },
      accounts,
    },
  })
}
