import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  featureEnabled: vi.fn(),
  seedScheduledJobs: vi.fn(),
  runAvailableJobs: vi.fn(),
  acquireLease: vi.fn(),
  startRun: vi.fn(),
  completeRun: vi.fn(),
  failRun: vi.fn(),
  releaseLease: vi.fn(),
}))

vi.mock('@/lib/feature-flags', () => ({ featureEnabled: mocks.featureEnabled }))
vi.mock('@/lib/job-runner', () => ({
  seedScheduledJobs: mocks.seedScheduledJobs,
  runAvailableJobs: mocks.runAvailableJobs,
}))
vi.mock('@/lib/operational-runs', () => ({
  acquireOperationalLease: mocks.acquireLease,
  startOperationalRun: mocks.startRun,
  completeOperationalRun: mocks.completeRun,
  failOperationalRun: mocks.failRun,
  releaseOperationalLease: mocks.releaseLease,
}))

import { GET } from './route'

const previousEnvironment = { ...process.env }

function request(token = 'cron-secret') {
  return new Request('https://ads.example.test/api/cron/scheduler', {
    headers: { authorization: `Bearer ${token}`, 'x-vercel-id': 'cron-request-1' },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.CRON_SECRET = 'cron-secret'
  process.env.MAINTENANCE_MODE = '1'
  mocks.featureEnabled.mockReturnValue(true)
  mocks.acquireLease.mockResolvedValue(true)
  mocks.seedScheduledJobs.mockResolvedValue({ requested: 1, created: 1 })
  mocks.runAvailableJobs.mockResolvedValue({ processed: 1, durationMs: 5, results: [{ status: 'completed' }] })
})

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in previousEnvironment)) delete process.env[key]
  }
  Object.assign(process.env, previousEnvironment)
})

describe('scheduler cron route', () => {
  it('fails closed when the dedicated scheduler switch is disabled', async () => {
    mocks.featureEnabled.mockReturnValue(false)
    const response = await GET(request())
    expect(response.status).toBe(503)
    expect(mocks.seedScheduledJobs).not.toHaveBeenCalled()
  })

  it('rejects a request without the cron bearer credential', async () => {
    const response = await GET(request('wrong'))
    expect(response.status).toBe(401)
    expect(mocks.acquireLease).not.toHaveBeenCalled()
  })

  it('can collect operational evidence during maintenance when explicitly enabled', async () => {
    const response = await GET(request())
    expect(response.status).toBe(200)
    expect(mocks.seedScheduledJobs).toHaveBeenCalledOnce()
    expect(mocks.runAvailableJobs).toHaveBeenCalledWith(expect.objectContaining({ maximumJobs: 25 }))
    expect(mocks.completeRun).toHaveBeenCalledWith(expect.objectContaining({
      component: 'scheduler',
      runKey: 'cron-request-1',
      workCount: 1,
    }))
    expect(mocks.releaseLease).toHaveBeenCalledOnce()
  })
})
