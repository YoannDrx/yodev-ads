import { describe, expect, it, vi } from 'vitest'
import { readBoundedResponse, ResponseSizeError } from './bounded-response'

describe('bounded HTTP bodies', () => {
  it('counts UTF-8 bytes across chunks without damaging split characters', async () => {
    const bytes = new TextEncoder().encode('Élan 🚀')
    const body = new ReadableStream({ start(controller) { controller.enqueue(bytes.slice(0, 1)); controller.enqueue(bytes.slice(1, 7)); controller.enqueue(bytes.slice(7)); controller.close() } })
    expect(await readBoundedResponse(new Response(body), bytes.length)).toEqual({ text: 'Élan 🚀', bytes: bytes.length })
    expect(await readBoundedResponse(new Response(null), 10)).toEqual({ text: '', bytes: 0 })
  })
  it('cancels a declared oversized body without reading it or waiting for remote cleanup', async () => {
    const cancel = vi.fn(() => new Promise<void>(() => undefined))
    const body = new ReadableStream({ cancel })
    await expect(readBoundedResponse(new Response(body, { headers: { 'content-length': '1001' } }), 1000)).rejects.toBeInstanceOf(ResponseSizeError)
    expect(cancel).toHaveBeenCalledOnce()
  })
  it.each<Record<string, string>>([{}, { 'content-length': '1' }])('enforces the streamed size even with absent or misleading length: %j', async (headers) => {
    const cancel = vi.fn()
    const body = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(5)); controller.enqueue(new Uint8Array(6)) }, cancel })
    await expect(readBoundedResponse(new Response(body, { headers }), 10)).rejects.toBeInstanceOf(ResponseSizeError)
    expect(cancel).toHaveBeenCalledOnce()
  })
  it('interrupts a stalled body when its signal expires and handles an already aborted request', async () => {
    const controller = new AbortController(), cancel = vi.fn()
    const response = new Response(new ReadableStream({ cancel }))
    const pending = readBoundedResponse(response, 1000, controller.signal)
    controller.abort(new Error('test deadline'))
    await expect(pending).rejects.toThrow('test deadline')
    expect(cancel).toHaveBeenCalledOnce()
    const alreadyCancelled = vi.fn()
    await expect(readBoundedResponse(new Response(new ReadableStream({ cancel: alreadyCancelled })), 1000, controller.signal)).rejects.toThrow('test deadline')
    expect(alreadyCancelled).toHaveBeenCalledOnce()
  })
})
