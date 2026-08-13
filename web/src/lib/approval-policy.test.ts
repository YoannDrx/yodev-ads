import { describe, expect, it } from 'vitest'
import { approvalPolicyForPlan } from '@/lib/approval-policy'

describe('workspace approval policy', () => {
  it('keeps Solo on one approval while allowing an explicit second interaction', () => {
    expect(approvalPolicyForPlan('solo', { requiredApprovals: 1, allowSelfApproval: true })).toEqual({
      requiredApprovals: 1, allowSelfApproval: true, approvalMode: 'single',
    })
    expect(() => approvalPolicyForPlan('solo', { requiredApprovals: 2, allowSelfApproval: false })).toThrow('Studio')
  })

  it('allows Studio dual approval and enforces Agency separation of duties', () => {
    expect(approvalPolicyForPlan('studio', { requiredApprovals: 2, allowSelfApproval: false }).approvalMode).toBe('dual')
    expect(approvalPolicyForPlan('internal', { requiredApprovals: 2, allowSelfApproval: true })).toMatchObject({ requiredApprovals: 2, allowSelfApproval: true })
    expect(() => approvalPolicyForPlan('agency', { requiredApprovals: 1, allowSelfApproval: true })).toThrow('désactivée')
  })

  it('keeps trials separated from Google mutations', () => {
    expect(approvalPolicyForPlan('trial', { requiredApprovals: 1, allowSelfApproval: false })).toMatchObject({ approvalMode: 'single', allowSelfApproval: false })
  })
})
