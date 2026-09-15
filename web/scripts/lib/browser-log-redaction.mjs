import { createInterface } from 'node:readline'

/** Local server logs must not publish the disposable credentials used by E2E. */
export function redactBrowserLog(line) {
  return line
    .replace(/^([ \t]*(?:-[ \t]*)?(?:cookie|set-cookie|authorization):)[^\r\n]*/gim, '$1 [REDACTED]')
    .replace(/(\/api\/auth\/reset-password\/)[^?\s/]+/gi, '$1[REDACTED]')
    .replace(/(\/r\/)[A-Za-z0-9_-]{20,}/g, '$1[REDACTED]')
    .replace(/([?&](?:token|code|email|password|secret|api_key|access_token|refresh_token)=)[^&#\s]+/gi, '$1[REDACTED]')
    .replace(/((?:%3F|%26)(?:token|code|email|password|secret|api_key|access_token|refresh_token)%3D)(?:(?!%26|%23)[^\s])+/gi, '$1[REDACTED]')
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
    .replace(/\bya_live_[A-Za-z0-9_-]+\b/g, '[REDACTED_API_KEY]')
}

export function pipeRedactedBrowserLog(stream, output) {
  // Buffer complete lines so a token split across stdout chunks stays redacted.
  const lines = createInterface({ input: stream, crlfDelay: Infinity })
  lines.on('line', (line) => output.write(`${redactBrowserLog(line)}\n`))
  return lines
}
