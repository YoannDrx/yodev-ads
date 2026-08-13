import { describe, expect, it } from 'vitest'
import { stateHash } from '@/lib/approval-state'

describe('approval state hashing', () => {
  it('is stable across object key order and sensitive to nested drift', () => {
    expect(stateHash({ status: 'PAUSED', budget: { amount: '10', shared: false } })).toBe(
      stateHash({ budget: { shared: false, amount: '10' }, status: 'PAUSED' }),
    )
    expect(stateHash({ status: 'PAUSED' })).not.toBe(stateHash({ status: 'ENABLED' }))
  })
})
