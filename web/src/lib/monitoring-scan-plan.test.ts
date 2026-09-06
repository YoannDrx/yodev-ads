import { describe, expect, it } from 'vitest'
import { monitoringScanPlan } from './monitoring-scan-plan'

describe('durable monitoring partitioning', () => {
  it('covers 50 accounts and 200 global vigies once per pair, with bounded batches', () => {
    const clients = Array.from({ length: 50 }, (_, index) => ({ id: `client-${index}`, active: true, isManager: false }))
    const agents = Array.from({ length: 200 }, (_, index) => ({ id: `agent-${index}`, kind: index % 2 ? 'no_delivery' : 'wasted_search_terms', clientId: null, enabled: true }))
    const chunks = monitoringScanPlan(agents, clients)
    expect(chunks).toHaveLength(2_000)
    expect(chunks.every((chunk) => chunk.agentIds.length <= 5)).toBe(true)
    const pairs = chunks.flatMap((chunk) => chunk.agentIds.map((agentId) => `${chunk.clientId}:${agentId}`))
    expect(pairs).toHaveLength(10_000)
    expect(new Set(pairs).size).toBe(10_000)
    expect(monitoringScanPlan([...agents].reverse(), [...clients].reverse())).toEqual(chunks)
  })

  it('honors client selection, paused vigies and inactive or manager accounts', () => {
    const agents = [
      { id: 'a', kind: 'forecast_overrun', clientId: 'one', enabled: true },
      { id: 'b', kind: 'pacing_variance', clientId: null, enabled: true },
      { id: 'paused', kind: 'pacing_variance', clientId: null, enabled: false },
    ]
    const clients = [
      { id: 'one', active: true, isManager: false },
      { id: 'two', active: true, isManager: false },
      { id: 'inactive', active: false, isManager: false },
      { id: 'manager', active: true, isManager: true },
    ]
    expect(monitoringScanPlan(agents, clients)).toEqual([
      { clientId: 'one', dataset: 'pacing', agentIds: ['a', 'b'] },
      { clientId: 'two', dataset: 'pacing', agentIds: ['b'] },
    ])
  })
})
