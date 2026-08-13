import { NextResponse } from 'next/server'
import { recordYodevMailEvent, verifyAndParseYodevMailWebhook } from '@/lib/yodev-mail-webhook'

const MAX_BODY_BYTES = 16 * 1024

export async function POST(request: Request) {
  const secret = process.env.YODEV_MAIL_WEBHOOK_SECRET
  if (!secret) return NextResponse.json({ error: 'not_configured' }, { status: 503 })
  if (Number(request.headers.get('content-length') ?? 0) > MAX_BODY_BYTES) return new NextResponse(null, { status: 413 })
  const body = await request.text()
  if (Buffer.byteLength(body) > MAX_BODY_BYTES) return new NextResponse(null, { status: 413 })
  let event: ReturnType<typeof verifyAndParseYodevMailWebhook>
  try {
    event = verifyAndParseYodevMailWebhook({
      body,
      signature: request.headers.get('x-yodev-mail-signature') ?? '',
      timestamp: request.headers.get('x-yodev-mail-timestamp') ?? '',
      secret,
    })
  } catch {
    return NextResponse.json({ error: 'invalid_webhook' }, { status: 400 })
  }
  const result = await recordYodevMailEvent(event)
  return NextResponse.json({ ok: true, duplicate: result.duplicate })
}
