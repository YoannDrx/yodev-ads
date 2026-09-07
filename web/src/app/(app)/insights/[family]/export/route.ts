import { createHash } from 'node:crypto'
import { requireWorkspacePermission } from '@/lib/workspace'
import { analyticalFamilies, type AnalyticalFamily } from '@/lib/analytical-model'
import { getAnalyticalExport } from '@/lib/analytical-pages'

export async function GET(request: Request, { params }: { params: Promise<{ family: string }> }) {
  let context: Awaited<ReturnType<typeof requireWorkspacePermission>>
  try { context = await requireWorkspacePermission('portfolio:read') } catch { return Response.json({ error: 'Forbidden' }, { status: 403 }) }
  const { family } = await params, query = new URL(request.url).searchParams
  if (!analyticalFamilies.includes(family as AnalyticalFamily)) return Response.json({ error: 'Collection unavailable' }, { status: 404 })
  const result = await getAnalyticalExport(context.workspace.id, query.get('client') ?? '', family as AnalyticalFamily, query.get('version') ?? '')
  if (!result) return Response.json({ error: 'Collection unavailable' }, { status: 404 })
  if (result.changed) return Response.json({ error: context.workspace.locale === 'en' ? 'The collection changed. Reopen it to export the latest version.' : 'La collecte a changé. Rouvrez-la pour exporter sa dernière version.' }, { status: 409, headers: { 'Cache-Control': 'private, no-store' } })
  const body = JSON.stringify(result.document)
  if (Buffer.byteLength(body, 'utf8') > 4 * 1024 * 1024) return Response.json({ error: 'Collection exceeds the supported export size' }, { status: 413 })
  return new Response(body, { headers: {
    'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
    'Content-Disposition': `attachment; filename="yodev-${family}-${result.document.sourceVersion}.json"`,
    'X-Content-SHA256': createHash('sha256').update(body).digest('hex'),
  } })
}
