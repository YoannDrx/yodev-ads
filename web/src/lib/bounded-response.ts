import 'server-only'

export class ResponseSizeError extends Error {
  constructor() { super('Response exceeds the supported size'); this.name = 'ResponseSizeError' }
}

export async function readBoundedResponse(response: Response, maximumBytes: number, signal?: AbortSignal) {
  if (signal?.aborted) { void response.body?.cancel().catch(() => undefined); signal.throwIfAborted() }
  if (Number(response.headers.get('content-length')) > maximumBytes) {
    void response.body?.cancel().catch(() => undefined)
    throw new ResponseSizeError()
  }
  if (!response.body) return { text: '', bytes: 0 }
  const reader = response.body.getReader(), chunks: Uint8Array[] = []
  let bytes = 0
  const abort = () => { void reader.cancel().catch(() => undefined) }
  signal?.addEventListener('abort', abort, { once: true })
  try {
    while (true) {
      signal?.throwIfAborted()
      const chunk = await reader.read()
      signal?.throwIfAborted()
      if (chunk.done) break
      bytes += chunk.value.byteLength
      if (bytes > maximumBytes) throw new ResponseSizeError()
      chunks.push(chunk.value)
    }
    return { text: Buffer.concat(chunks, bytes).toString('utf8'), bytes }
  } finally {
    signal?.removeEventListener('abort', abort)
    void reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}
