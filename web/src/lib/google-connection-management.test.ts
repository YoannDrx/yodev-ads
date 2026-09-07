import { describe, expect, it } from 'vitest'
import { googleConnectionVersion } from './google-connection-management'

const connection = { id: 'connection', status: 'active', managerCustomerId: '1234567890', encryptedRefreshToken: 'encrypted-fixture', scopes: ['email', 'ads'] }
describe('pending Google authorization connection version', () => {
  it('distinguishes absence, deletion and replacement while tolerating scope order', () => {
    expect(googleConnectionVersion(null)).toBe('none')
    expect(googleConnectionVersion(connection)).toBe(googleConnectionVersion({ ...connection, scopes: ['ads', 'email'] }))
    expect(googleConnectionVersion({ ...connection, id: 'replacement' })).not.toBe(googleConnectionVersion(connection))
  })
  it.each([{ status: 'revoked' }, { managerCustomerId: '9876543210' }, { encryptedRefreshToken: 'new-grant' }, { scopes: ['ads'] }])('invalidates authorization when connection credentials or availability change', (change) => {
    expect(googleConnectionVersion({ ...connection, ...change })).not.toBe(googleConnectionVersion(connection))
  })
})
