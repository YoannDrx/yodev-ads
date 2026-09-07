import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PassThrough } from 'node:stream'
import { once } from 'node:events'
import { pipeRedactedBrowserLog, redactBrowserLog } from './browser-log-redaction.mjs'

test('browser logs retain routes and outcomes without authentication or report secrets', () => {
  const result = redactBrowserLog('GET /api/auth/reset-password/resetSecret?callbackURL=%2Freset-password 302\nGET /verify?token=emailSecret&callbackURL=%2Faccount 302\nGET /r/report_secret_12345678901234567890/pdf?email=user@example.test 200\nurl=%2Fverify%3Ftoken%3DencodedSecret%26ok%3D1 Bearer privateCredential ya_live_privateKey')
  for (const secret of ['resetSecret', 'emailSecret', 'report_secret_12345678901234567890', 'user@example.test', 'encodedSecret', 'privateCredential', 'ya_live_privateKey']) assert(!result.includes(secret))
  assert(result.includes('reset-password/[REDACTED]?callbackURL=%2Freset-password 302'))
  assert(result.includes('%26ok%3D1'))
})

test('a secret split across output chunks and an unterminated last line stay redacted', async () => {
  const input = new PassThrough(), captured = []
  const lines = pipeRedactedBrowserLog(input, { write: (line) => captured.push(line) })
  const closed = once(lines, 'close')
  input.write('GET /verify?token=split')
  input.write('Secret&ok=1 302\nGET /reset-password?token=lastSecret')
  input.end()
  await closed
  assert.equal(captured.join(''), 'GET /verify?token=[REDACTED]&ok=1 302\nGET /reset-password?token=[REDACTED]\n')
})

test('Playwright request failures do not print session or authorization headers', () => {
  const output = redactBrowserLog('Error: ECONNRESET\n    - cookie: yodev_ads.session_token=privateSession; consent=rejected\n    - Authorization: Basic privateHeader\nSet-Cookie: privateResponse; Secure\n    - content-type: application/json\n  1 failed')
  for (const secret of ['privateSession', 'privateHeader', 'privateResponse']) assert(!output.includes(secret))
  assert(output.includes('Error: ECONNRESET'))
  assert(output.includes('content-type: application/json'))
  assert(output.includes('1 failed'))
})
