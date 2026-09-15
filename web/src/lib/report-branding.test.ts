import { describe, expect, it } from 'vitest'
import { contrastText, reportAccent } from './report-branding'
import { printableReportText, wrapReportLines } from './client-report-pdf'

describe('report text and brand accessibility', () => {
  it('uses a controlled color and chooses readable black or white text', () => {
    expect(reportAccent('url(javascript:alert(1))')).toBe('#176646')
    expect(contrastText('#ffffff')).toBe('#000000')
    expect(contrastText('#000000')).toBe('#ffffff')
    expect(contrastText('#ffff00')).toBe('#000000')
  })
  it('preserves supported accents and explicitly names unsupported code points', () => {
    const chars = new Set([...Array.from({ length: 95 }, (_, index) => index + 32), 'é'.codePointAt(0)!])
    expect(printableReportText('été — 🚀\n東京', chars)).toBe('été - [U+1F680]\n[U+6771][U+4EAC]')
    expect(printableReportText('e\u0301\tOK\r\n', chars)).toBe('é    OK\n')
  })
  it('preserves every character of words longer than a page line', () => {
    const source = `START ${'w'.repeat(5000)} END\n\nLAST`
    const lines = wrapReportLines(source, (text) => text.length, 41)
    expect(lines.every((line) => line.length <= 41)).toBe(true)
    expect(lines.join('').replaceAll(' ', '')).toBe(source.replace(/\s/g, ''))
    expect(lines).toContain('')
  })
})
