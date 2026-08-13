import { unzipSync, strFromU8 } from 'fflate'
import { describe, expect, it } from 'vitest'
import { exportArchive, rowsToCsv } from './workspace-export'

describe('workspace export artifacts', () => {
  it('escapes CSV cells deterministically', () => {
    expect(rowsToCsv([{ name: 'ACME, Inc.', note: 'line 1\n"line 2"', empty: null }])).toBe(
      'name,note,empty\r\n"ACME, Inc.","line 1\n""line 2""",',
    )
  })

  it('builds a readable zip with the requested files', () => {
    const archive = unzipSync(exportArchive({ 'raw.json': '{"ok":true}\n', 'clients.csv': 'id,name\r\n1,ACME' }))
    expect(strFromU8(archive['raw.json'])).toBe('{"ok":true}\n')
    expect(strFromU8(archive['clients.csv'])).toBe('id,name\r\n1,ACME')
  })
})
