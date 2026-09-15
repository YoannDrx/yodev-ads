import { auditProductionConfiguration, type ReleaseTarget } from '@/lib/production-readiness'
import { releaseOperationalIssues } from '@/lib/release-operational-readiness'
import { systemHealthSnapshot } from '@/lib/system-health'
import { releaseIdentityIssue, releaseVerificationAuthorized } from '@/lib/release-verification-access'

export const dynamic = 'force-dynamic'

const noStoreHeaders = { 'Cache-Control': 'no-store, max-age=0' }

function releaseTarget(value: string | undefined): ReleaseTarget | null {
  return value === 'staging' || value === 'private_beta' || value === 'public' ? value : null
}

async function operationalIssues() {
  try {
    const health = await systemHealthSnapshot()
    const issues: Array<{ code: string; message: string }> = []
    if (health.scheduler.status !== 'completed' || health.scheduler.overdue) {
      issues.push({
        code: 'health.scheduler_unhealthy',
        message: 'Scheduler must have a recent completed operational run',
      })
    }
    if (health.retention.status !== 'completed' || health.retention.overdue) {
      issues.push({
        code: 'health.retention_unhealthy',
        message: 'Retention must have a recent completed operational run',
      })
    }
    return [...issues, ...await releaseOperationalIssues()]
  } catch {
    return [{
      code: 'health.database_unavailable',
      message: 'Database and operational health evidence must be reachable',
    }]
  }
}

export async function GET(request: Request) {
  if (!releaseVerificationAuthorized(request)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401, headers: noStoreHeaders })
  }
  const identityIssue = releaseIdentityIssue(request, false)
  if (identityIssue) return Response.json({ ready: false, code: identityIssue }, { status: 412, headers: noStoreHeaders })

  const target = releaseTarget(process.env.RELEASE_TARGET)
  if (!target) {
    return Response.json({
      ready: false,
      target: 'unknown',
      issues: [{ code: 'invalid.RELEASE_TARGET', message: 'RELEASE_TARGET must be staging, private_beta or public' }],
      checkedAt: new Date().toISOString(),
    }, { status: 503, headers: noStoreHeaders })
  }

  const configuration = auditProductionConfiguration(process.env, target)
  const issues = [...configuration.issues, ...await operationalIssues()]
  const ready = issues.length === 0
  return Response.json({
    ready,
    issues,
    target,
    release: process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.NEXT_PUBLIC_RELEASE_SHA ?? null,
    checkedAt: new Date().toISOString(),
  }, { status: ready ? 200 : 503, headers: noStoreHeaders })
}
