import { getPublicShare } from '@/lib/data'
import { createClientReportPdf } from '@/lib/client-report-pdf'
import { buildClientReportModel } from '@/lib/client-report-model'
import { GoogleAdsGateway } from '@/lib/google-ads'
import { consumePublicReportRateLimits, requestIp } from '@/lib/rate-limit'

export async function GET(request: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params
  const result = await getPublicShare(token, request.headers.get('x-forwarded-host') ?? request.headers.get('host'))
  if (!result) return new Response('Rapport introuvable', { status: 404 })
  const rate = await consumePublicReportRateLimits({
    workspaceId: result.share.workspaceId,
    token,
    ip: requestIp(request.headers),
    pdf: true,
  })
  if (!rate.allowed) {
    return new Response('Trop de requêtes', { status: 429, headers: { 'Retry-After': String(rate.retryAfterSeconds) } })
  }
  const campaigns = await new GoogleAdsGateway(result.connection).campaignPerformance(result.client.googleCustomerId)
  const whiteLabel = result.workspace.plan === 'studio' || result.workspace.plan === 'agency' || result.workspace.plan === 'internal'
  const report = buildClientReportModel({
    brandName: whiteLabel ? result.workspace.brandName : 'Ads by Yodev',
    poweredByYodev: result.workspace.plan === 'studio',
    clientName: result.client.name,
    currencyCode: result.client.currencyCode,
    campaigns,
    periodDays: result.share.periodDays,
    locale: result.share.locale,
    editorialComment: result.share.editorialComment,
    actionPlan: result.share.actionPlan,
  })
  const pdf = await createClientReportPdf(report)
  return new Response(Buffer.from(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="rapport-${result.client.googleCustomerId}.pdf"`,
      'Cache-Control': 'private, no-store',
    },
  })
}
