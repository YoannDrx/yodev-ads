import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { decryptSecret } from '@/lib/crypto'
import { requireWorkspacePermission } from '@/lib/workspace'
import { consumeWorkspaceSecretRevelation } from '@/lib/data'

const COOKIE_NAME = 'yodev_secret_revelation'

export async function POST() {
  const requestId = crypto.randomUUID()
  try {
    const { workspace, session } = await requireWorkspacePermission('workspace:read')
    const cookieStore = await cookies()
    const revelationId = cookieStore.get(COOKIE_NAME)?.value
    if (!revelationId) throw new Error('Aucune révélation en attente.')
    const revelation = await consumeWorkspaceSecretRevelation(workspace.id, session.userId, revelationId)
    cookieStore.delete(COOKIE_NAME)
    if (!revelation) throw new Error('Cette clé a déjà été révélée ou a expiré.')
    return NextResponse.json(
      { data: { secret: decryptSecret(revelation.encryptedSecret) }, meta: { requestId, nextCursor: null } },
      { headers: { 'Cache-Control': 'no-store', 'X-Request-Id': requestId } },
    )
  } catch (error) {
    return NextResponse.json(
      { error: { code: 'REVELATION_UNAVAILABLE', message: error instanceof Error ? error.message : 'Révélation indisponible', requestId, details: {} } },
      { status: 404, headers: { 'Cache-Control': 'no-store', 'X-Request-Id': requestId } },
    )
  }
}
