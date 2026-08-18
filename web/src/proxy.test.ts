import { afterEach, describe, expect, it } from 'vitest'
import { NextRequest } from 'next/server'
import proxy from './proxy'

const previousMaintenanceMode = process.env.MAINTENANCE_MODE

afterEach(() => {
  if (previousMaintenanceMode === undefined) delete process.env.MAINTENANCE_MODE
  else process.env.MAINTENANCE_MODE = previousMaintenanceMode
})

describe('maintenance routing', () => {
  it('keeps provider webhooks reachable during a maintenance cutover', () => {
    process.env.MAINTENANCE_MODE = '1'

    for (const path of ['/api/webhooks/stripe', '/api/webhooks/yodev-mail']) {
      const response = proxy(new NextRequest(`https://ads.yodev.fr${path}`, { method: 'POST' }))
      expect(response.status).toBe(200)
      expect(response.headers.get('x-middleware-next')).toBe('1')
    }
  })

  it('keeps the authenticated runtime readiness probe reachable during maintenance', () => {
    process.env.MAINTENANCE_MODE = '1'

    const response = proxy(new NextRequest('https://ads.yodev.fr/api/internal/release-readiness'))
    expect(response.status).toBe(200)
    expect(response.headers.get('x-middleware-next')).toBe('1')
  })

  it('continues to fail closed for unrelated writes', async () => {
    process.env.MAINTENANCE_MODE = '1'

    const response = proxy(new NextRequest('https://ads.yodev.fr/api/v1/alerts', { method: 'POST' }))
    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({ error: 'Ads by Yodev is temporarily in maintenance mode.' })
  })
})
