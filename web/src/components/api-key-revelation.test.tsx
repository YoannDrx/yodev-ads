// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { SecretRevelation } from './api-key-revelation'

const props = { title: 'Pending secret', buttonLabel: 'Reveal now', workspaceId: 'workspace', revelationId: 'revelation', kind: 'api_key' as const, locale: 'en' as const }
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
describe('one-time secret revelation', () => {
  it('binds the request to the displayed workspace, secret and kind', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { secret: 'fixture-only' } })))
    vi.stubGlobal('fetch', fetch); render(<SecretRevelation {...props} />)
    fireEvent.click(screen.getByRole('button'))
    expect(await screen.findByRole('textbox', { name: props.title })).toHaveValue('fixture-only')
    expect(fetch).toHaveBeenCalledWith('/api/secret-revelation', expect.objectContaining({ method: 'POST', body: JSON.stringify({ workspaceId: props.workspaceId, revelationId: props.revelationId, kind: props.kind }) }))
    expect(screen.queryByRole('button', { name: 'Reveal now' })).not.toBeInTheDocument()
  })
  it.each(['fr', 'en'] as const)('recovers from a network failure in %s without leaving a spinner', async (locale) => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    render(<SecretRevelation {...props} locale={locale} />); fireEvent.click(screen.getByRole('button'))
    expect(await screen.findByRole('alert')).toHaveTextContent(locale === 'fr' ? 'La réponse n’a pas pu' : 'The response could not')
    expect(screen.getByRole('button')).toBeEnabled()
  })
  it.each([new Response('{', { status: 200 }), new Response(JSON.stringify({ data: { secret: 123 } }), { status: 200 }), new Response('Sensitive internal error', { status: 404 })])('handles malformed or refused responses without exposing details', async (response) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response)); render(<SecretRevelation {...props} />); fireEvent.click(screen.getByRole('button'))
    await screen.findByRole('alert'); expect(screen.getByRole('button')).toBeEnabled()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument(); expect(screen.queryByText('Sensitive internal error')).not.toBeInTheDocument()
  })
  it('disables a stale URL with no revelation identifier', () => {
    render(<SecretRevelation {...props} revelationId={undefined} />)
    expect(screen.getByRole('button')).toBeDisabled(); expect(screen.getByRole('alert')).toHaveTextContent('Refresh the page')
  })
  it('discards a previous value when the pending revelation changes', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { secret: 'old-value' } })))); const view = render(<SecretRevelation key="first" {...props} />)
    fireEvent.click(screen.getByRole('button')); await screen.findByRole('textbox')
    view.rerender(<SecretRevelation key="second" {...props} revelationId="second" />)
    await waitFor(() => expect(screen.queryByRole('textbox')).not.toBeInTheDocument()); expect(screen.getByRole('button')).toBeEnabled()
  })
  it.each([false, true])('provides explicit copy with confirmation or a manual fallback (blocked=%s)', async (blocked) => {
    const writeText = blocked ? vi.fn().mockRejectedValue(new Error('denied')) : vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { secret: 'fixture-only' } })))); render(<SecretRevelation {...props} />)
    fireEvent.click(screen.getByRole('button')); await screen.findByRole('textbox')
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
    expect(writeText).toHaveBeenCalledWith('fixture-only')
    if (blocked) expect(await screen.findByRole('alert')).toHaveTextContent('copy its contents manually')
    else expect(await screen.findByRole('status')).toHaveTextContent('Copied.')
  })
  it('presents separate DNS fields and copies the TXT value instead of the JSON envelope', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined), record = { type: 'TXT', name: '_yodev-ads.example.test', value: 'yodev-domain-verification=fixture' }
    vi.stubGlobal('navigator', { clipboard: { writeText } }); vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { secret: JSON.stringify(record) } }))))
    render(<SecretRevelation {...props} kind="domain_dns" />); fireEvent.click(screen.getByRole('button'))
    expect(await screen.findByRole('textbox', { name: 'DNS name' })).toHaveValue(record.name)
    expect(screen.getByRole('textbox', { name: 'TXT value' })).toHaveValue(record.value)
    fireEvent.click(screen.getByRole('button', { name: 'Copy value' })); await screen.findByRole('status')
    expect(writeText).toHaveBeenCalledWith(record.value)
  })
})
