import { getPublicShare } from '@/lib/data'
import { createClientReportPdf } from '@/lib/client-report-pdf'
import { GoogleAdsGateway } from '@/lib/google-ads'

export async function GET(_request: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params
  const result = await getPublicShare(token)
  if (!result) return new Response('Rapport introuvable', { status: 404 })
  const campaigns = await new GoogleAdsGateway(result.connection).campaignPerformance(result.client.googleCustomerId)
  const pdf = await createClientReportPdf({
    brandName: 'Ads by Yodev',
    clientName: result.client.name,
    currencyCode: result.client.currencyCode,
    campaigns,
  })
  return new Response(Buffer.from(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="rapport-${result.client.googleCustomerId}.pdf"`,
      'Cache-Control': 'private, no-store',
    },
  })
}
