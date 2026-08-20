import { timingSafeEqual } from 'node:crypto'
import { GoogleAdsReadDrillError, runGoogleAdsReadDrill } from '@/lib/google-ads-read-drill'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const noStoreHeaders = { 'Cache-Control': 'no-store, max-age=0' }

function authorized(request: Request) {
  const expected = process.env.RELEASE_VERIFICATION_TOKEN
  const authorization = request.headers.get('authorization')
  const provided = authorization?.startsWith('Bearer ') ? authorization.slice(7) : ''
  if (!expected || !provided) return false
  const expectedBytes = Buffer.from(expected)
  const providedBytes = Buffer.from(provided)
  return expectedBytes.length === providedBytes.length && timingSafeEqual(expectedBytes, providedBytes)
}

export async function POST(request: Request) {
  if (!authorized(request)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401, headers: noStoreHeaders })
  }
  if (process.env.RELEASE_TARGET !== 'staging') {
    return Response.json({ verified: false, code: 'staging_only' }, { status: 409, headers: noStoreHeaders })
  }
  if (
    process.env.GOOGLE_READS_ENABLED !== '1'
    || process.env.GOOGLE_MUTATIONS_ENABLED !== '0'
    || process.env.FORCE_READ_ONLY !== '1'
  ) {
    return Response.json({ verified: false, code: 'read_only_guard_not_satisfied' }, { status: 409, headers: noStoreHeaders })
  }

  try {
    const evidence = await runGoogleAdsReadDrill()
    return Response.json({
      ...evidence,
      release: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
      checkedAt: new Date().toISOString(),
    }, { headers: noStoreHeaders })
  } catch (error) {
    const failure = error instanceof GoogleAdsReadDrillError
      ? { code: error.code, stage: error.stage, requestId: error.requestId }
      : { code: 'read_drill_failed', stage: 'unknown', requestId: null }
    return Response.json({ verified: false, ...failure }, { status: 502, headers: noStoreHeaders })
  }
}
