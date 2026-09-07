import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { decryptSecret } from '@/lib/crypto'
import { requireWorkspacePermission } from '@/lib/workspace'
import { consumeWorkspaceSecretRevelation } from '@/lib/data'

const COOKIE_NAME = 'yodev_secret_revelation'

export async function POST(request: Request) {
  const requestId = crypto.randomUUID()
  try {
    const { workspace, session } = await requireWorkspacePermission('workspace:read')
    const input = z.object({ workspaceId: z.uuid(), revelationId: z.uuid(), kind: z.enum(['api_key', 'report_url', 'domain_dns']) }).parse(await request.json())
    const cookieStore = await cookies()
    const revelationId = cookieStore.get(COOKIE_NAME)?.value
    if (!revelationId || revelationId !== input.revelationId || workspace.id !== input.workspaceId) throw new Error('Révélation indisponible.')
    const revelation = await consumeWorkspaceSecretRevelation(workspace.id, session.userId, revelationId, input.kind)
    // The DB marker enforces one-time consumption. A clearing Set-Cookie from a
    // delayed response could erase a newer revelation created in another tab.
    if (!revelation) throw new Error('Cette clé a déjà été révélée ou a expiré.')
    return NextResponse.json(
      { data: { secret: decryptSecret(revelation.encryptedSecret) }, meta: { requestId, nextCursor: null } },
      { headers: { 'Cache-Control': 'no-store', 'X-Request-Id': requestId } },
    )
  } catch {
    return NextResponse.json(
      { error: { code: 'REVELATION_UNAVAILABLE', message: 'Révélation indisponible.', requestId, details: {} } },
      { status: 404, headers: { 'Cache-Control': 'no-store', 'X-Request-Id': requestId } },
    )
  }
}
