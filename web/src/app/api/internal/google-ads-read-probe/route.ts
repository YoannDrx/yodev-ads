import { GoogleAdsReadDrillError, runGoogleAdsReadProbe } from '@/lib/google-ads-read-drill'
import { releaseIdentityIssue, releaseVerificationAuthorized } from '@/lib/release-verification-access'
import { withWorkDeadline } from '@/lib/work-deadline'

export const dynamic = 'force-dynamic'
export const maxDuration = 60
const headers = { 'Cache-Control': 'no-store, max-age=0' }

export async function GET(request: Request) {
  const startedAt = Date.now()
  if (!releaseVerificationAuthorized(request)) return Response.json({ error: 'Unauthorized' }, { status: 401, headers })
  const identityIssue = releaseIdentityIssue(request, true)
  if (identityIssue) return Response.json({ verified: false, code: identityIssue }, { status: 412, headers })
  if (!['staging', 'private_beta', 'public'].includes(process.env.RELEASE_TARGET ?? '') || process.env.GOOGLE_READS_ENABLED !== '1') {
    return Response.json({ verified: false, code: 'read_probe_unavailable' }, { status: 409, headers })
  }
  try {
    // The underlying interface exposes only read methods. Mutation switches
    // can remain enabled for the product without adding an effect to this probe.
    const evidence = await withWorkDeadline(startedAt + 50_000, runGoogleAdsReadProbe)
    return Response.json({ ...evidence, target: process.env.RELEASE_TARGET,
      release: process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.NEXT_PUBLIC_RELEASE_SHA ?? null,
      checkedAt: new Date().toISOString(),
    }, { headers })
  } catch (error) {
    const failure = error instanceof GoogleAdsReadDrillError
      ? { code: error.code, stage: error.stage, requestId: error.requestId }
      : { code: 'read_probe_failed', stage: 'unknown', requestId: null }
    return Response.json({ verified: false, ...failure }, { status: 502, headers })
  }
}
