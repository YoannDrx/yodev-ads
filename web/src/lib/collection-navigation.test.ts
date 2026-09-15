import { expect, it } from 'vitest'
import { preserveCollectionRecord } from './collection-navigation'
const id = '78000000-0000-4000-8000-000000000001'
it('retains the edited record after success or failure', () => {
  for (const path of ['/tasks', '/alerts?error=denied', '/approvals?notice=done', '/support?notice=sent']) expect(new URL(preserveCollectionRecord(path, id), 'https://example.test').searchParams.get('id')).toBe(id)
})
it('discards invalid ids without changing the action destination', () => {
  for (const value of [null, 'https://evil.test', `${id}&next=evil`, new Blob(['invalid'])]) expect(preserveCollectionRecord('/tasks?error=invalid', value)).toBe('/tasks?error=invalid')
})
