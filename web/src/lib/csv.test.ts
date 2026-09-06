import { describe, expect, it } from 'vitest'
import { spreadsheetText } from './csv'
import { rowsToCsv } from './workspace-export'
import { buildClientReportModel, clientReportCsv } from './client-report-model'

describe('spreadsheet text safety', () => {
  it.each(['=1+1', '+cmd', '-1+2', '@SUM(A1)', '\t=1', '\r=1', '\n=1', ' \u0000=1', '\tplain'])('neutralizes %j', (text) => {
    expect(spreadsheetText(text)).toBe("'" + text)
    expect(rowsToCsv([{ value: text }])).toContain("'" + text)
    const csv = clientReportCsv(buildClientReportModel({ brandName: 'Test', clientName: text, currencyCode: 'EUR', campaigns: [] }))
    expect(csv).toContain('"' + "'" + text + '"')
  })
  it('preserves numeric values and escapes headers', () => {
    expect(rowsToCsv([{ '=unsafe': -42, 'a,b': 'safe' }])).toBe("'=unsafe,\"a,b\"\r\n-42,safe")
    expect(spreadsheetText('Hello, "world"')).toBe('Hello, "world"')
  })
})
