import { describe, expect, it } from 'vitest'
import { StatusBadge } from './status-badge'

describe('localized status badges', () => {
  it('renders French by default and English when requested', () => {
    expect(StatusBadge({ status: 'pending' }).props.children).toBe('À approuver')
    expect(StatusBadge({ status: 'pending', locale: 'en' }).props.children).toBe('Pending approval')
    expect(StatusBadge({ status: 'inactive', locale: 'en' }).props.children).toBe('Inactive')
  })

  it('preserves unknown provider statuses for operational evidence', () => {
    expect(StatusBadge({ status: 'PROVIDER_SPECIFIC', locale: 'en' }).props.children).toBe('PROVIDER_SPECIFIC')
  })
})
