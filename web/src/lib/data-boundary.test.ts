import { describe, expect, it } from 'vitest'
import { appDataBoundaryViolations } from './data-boundary'

describe('App Router data boundary', () => {
  it('rejects direct schema, transaction and Drizzle imports', () => {
    expect(appDataBoundaryViolations([
      { path: 'src/app/api/route.ts', source: "import { clients } from '@/db/schema'" },
      { path: 'src/app/page.tsx', source: "import { eq } from 'drizzle-orm'" },
      { path: 'src/app/actions.ts', source: "import { withTenantTransaction } from '@/db/transactions'" },
    ])).toEqual([
      { file: 'src/app/api/route.ts', importSource: '@/db/schema' },
      { file: 'src/app/page.tsx', importSource: 'drizzle-orm' },
      { file: 'src/app/actions.ts', importSource: '@/db/transactions' },
    ])
  })

  it('supports an explicit shrinking migration allowlist', () => {
    expect(appDataBoundaryViolations(
      [{ path: 'src/app/actions.ts', source: "import { clients } from '@/db/schema'" }],
      new Set(['src/app/actions.ts']),
    )).toEqual([])
  })
})
