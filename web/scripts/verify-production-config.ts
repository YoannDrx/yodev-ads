import { auditProductionConfiguration, type ReleaseTarget } from '../src/lib/production-readiness'

const target = (process.env.RELEASE_TARGET ?? 'staging') as ReleaseTarget
if (!['staging', 'private_beta', 'public'].includes(target)) {
  throw new Error('RELEASE_TARGET must be staging, private_beta or public')
}

const result = auditProductionConfiguration(process.env, target)
if (!result.ready) {
  console.error(JSON.stringify({
    ready: false,
    target,
    issues: result.issues,
  }, null, 2))
  process.exitCode = 1
} else {
  console.log(JSON.stringify({ ready: true, target, checks: 'passed' }))
}
