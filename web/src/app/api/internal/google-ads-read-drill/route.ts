import { GoogleAdsReadDrillError, runGoogleAdsReadDrill } from '@/lib/google-ads-read-drill'
import { releaseIdentityIssue, releaseVerificationAuthorized } from '@/lib/release-verification-access'
import { withWorkDeadline } from '@/lib/work-deadline'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const noStoreHeaders = { 'Cache-Control': 'no-store, max-age=0' }

export async function POST(request: Request) {
  const startedAt = Date.now()
  if (!releaseVerificationAuthorized(request)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401, headers: noStoreHeaders })
  }
  const identityIssue = releaseIdentityIssue(request, false)
  if (identityIssue) return Response.json({ verified: false, code: identityIssue }, { status: 412, headers: noStoreHeaders })
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
    const evidence = await withWorkDeadline(startedAt + 50_000, runGoogleAdsReadDrill)
    return Response.json({
      ...evidence,
      target: process.env.RELEASE_TARGET,
      release: process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.NEXT_PUBLIC_RELEASE_SHA ?? null,
      checkedAt: new Date().toISOString(),
    }, { headers: noStoreHeaders })
  } catch (error) {
    const failure = error instanceof GoogleAdsReadDrillError
      ? { code: error.code, stage: error.stage, requestId: error.requestId }
      : { code: 'read_drill_failed', stage: 'unknown', requestId: null }
    return Response.json({ verified: false, ...failure }, { status: 502, headers: noStoreHeaders })
  }
}
