import { releaseIdentityIssue, releaseVerificationAuthorized } from '@/lib/release-verification-access'
import { runSentryReadProbe } from '@/lib/sentry-read-probe'
import { withWorkDeadline } from '@/lib/work-deadline'

export const dynamic = 'force-dynamic'
export const maxDuration = 20
const headers = { 'Cache-Control': 'no-store, max-age=0' }

export async function GET(request: Request) {
  if (!releaseVerificationAuthorized(request)) return Response.json({ error: 'Unauthorized' }, { status: 401, headers })
  const identityIssue = releaseIdentityIssue(request, true)
  if (identityIssue) return Response.json({ verified: false, code: identityIssue }, { status: 412, headers })
  if (!['staging', 'private_beta', 'public'].includes(process.env.RELEASE_TARGET ?? '')) return Response.json({ verified: false, code: 'release.invalid_target' }, { status: 409, headers })
  try {
    const evidence = await withWorkDeadline(Date.now() + 15_000, () => runSentryReadProbe())
    return Response.json({ ...evidence, target: process.env.RELEASE_TARGET,
      release: process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.NEXT_PUBLIC_RELEASE_SHA ?? null,
      checkedAt: new Date().toISOString(),
    }, { headers })
  } catch {
    return Response.json({ verified: false, code: 'sentry.read_probe_failed' }, { status: 502, headers })
  }
}
