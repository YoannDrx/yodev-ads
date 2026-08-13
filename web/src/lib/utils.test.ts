import { describe, expect, it } from 'vitest'
import { cn } from './utils'

describe('cn', () => {
  it('merges conditional and conflicting Tailwind classes', () => {
    expect(cn('px-2 text-red-500', false && 'hidden', ['px-4', { block: true }])).toBe('text-red-500 px-4 block')
  })
})
