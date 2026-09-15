import { getPublicShare } from '@/lib/data'
import { getPublicReportEdition } from '@/lib/report-editions'
import { clientReportCsv } from '@/lib/client-report-model'
import { consumePublicReportRateLimits, requestIp } from '@/lib/rate-limit'

export async function GET(request: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params
  const result = await getPublicShare(token, request.headers.get('x-forwarded-host') ?? request.headers.get('host'))
  if (!result) return new Response('Rapport introuvable', { status: 404, headers: { 'Cache-Control': 'private, no-store' } })
  const rate = await consumePublicReportRateLimits({ workspaceId: result.share.workspaceId, token, ip: requestIp(request.headers), pdf: true })
  if (!rate.allowed) return new Response('Trop de requêtes', { status: 429, headers: { 'Retry-After': String(rate.retryAfterSeconds), 'Cache-Control': 'private, no-store' } })
  let issued: Awaited<ReturnType<typeof getPublicReportEdition>>
  try {
    issued = await getPublicReportEdition({ workspaceId: result.share.workspaceId, shareId: result.share.id, editionId: new URL(request.url).searchParams.get('edition') ?? undefined })
  } catch {
    return new Response(result.share.locale === 'en' ? 'This edition is unavailable or its period is not fully collected.' : 'Cette édition n’est pas disponible ou sa période n’est pas entièrement collectée.', { status: 409, headers: { 'Cache-Control': 'private, no-store' } })
  }
  return new Response(clientReportCsv(issued.model), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="rapport-${result.client.googleCustomerId}-${issued.edition.editionNumber}.csv"`,
      'Cache-Control': 'private, no-store',
      'X-Report-Edition': issued.edition.id,
      'X-Report-Data-Version': issued.edition.sourceVersion,
    },
  })
}
