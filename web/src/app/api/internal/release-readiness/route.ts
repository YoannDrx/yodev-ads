import { timingSafeEqual } from 'node:crypto'
import { auditProductionConfiguration, type ReleaseTarget } from '@/lib/production-readiness'

export const dynamic = 'force-dynamic'

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

function releaseTarget(value: string | undefined): ReleaseTarget | null {
  return value === 'staging' || value === 'private_beta' || value === 'public' ? value : null
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401, headers: noStoreHeaders })
  }

  const target = releaseTarget(process.env.RELEASE_TARGET)
  if (!target) {
    return Response.json({
      ready: false,
      target: 'unknown',
      issues: [{ code: 'invalid.RELEASE_TARGET', message: 'RELEASE_TARGET must be staging, private_beta or public' }],
      checkedAt: new Date().toISOString(),
    }, { status: 503, headers: noStoreHeaders })
  }

  const result = auditProductionConfiguration(process.env, target)
  return Response.json({
    ...result,
    target,
    release: process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.NEXT_PUBLIC_RELEASE_SHA ?? null,
    checkedAt: new Date().toISOString(),
  }, { status: result.ready ? 200 : 503, headers: noStoreHeaders })
}
