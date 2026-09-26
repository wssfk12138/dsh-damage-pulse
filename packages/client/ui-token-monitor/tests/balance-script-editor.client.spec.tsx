// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { BalanceScriptEditor } from '../src/client/BalanceScriptEditor.tsx'
import { zh, type DetailTranslate } from '../src/client/detail-locales.ts'

const t: DetailTranslate = key => zh[key]
const snapshot = (provider: string, script = '', revision = 0, status = 'unconfigured') => ({ provider, script, revision, status })
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals() })

it('saves each provider independently and retains edits made during an outstanding save', async () => {
  vi.useFakeTimers()
  let resolveFirst!: (value: Response) => void
  const writes: Array<{ provider: string; script: string; expectedRevision: number }> = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const provider = new URL(url, 'http://localhost').searchParams.get('provider')!
    if (!init) return response(snapshot(provider))
    const body = JSON.parse(init.body as string) as { script: string; expectedRevision: number }
    writes.push({ provider, ...body })
    if (writes.length === 1) return new Promise<Response>((resolve) => { resolveFirst = resolve })
    return response(snapshot(provider, body.script, body.expectedRevision + 1, 'valid'))
  }))
  const onBusyChange = vi.fn()
  const view = render(<BalanceScriptEditor provider="a" t={t} onBusyChange={onBusyChange} />)
  await act(async () => {})
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'first-a' } })
  await act(async () => { await vi.advanceTimersByTimeAsync(500) })
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'latest-a' } })
  view.rerender(<BalanceScriptEditor provider="b" t={t} onBusyChange={onBusyChange} />)
  await act(async () => {})
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'only-b' } })
  await act(async () => { await vi.advanceTimersByTimeAsync(500) })
  await act(async () => { resolveFirst(response(snapshot('a', 'first-a', 1, 'valid'))) })
  expect(screen.getByRole<HTMLTextAreaElement>('textbox').value).toBe('only-b')
  view.rerender(<BalanceScriptEditor provider="a" t={t} onBusyChange={onBusyChange} />)
  expect(screen.getByRole<HTMLTextAreaElement>('textbox').value).toBe('latest-a')
  await act(async () => { await vi.advanceTimersByTimeAsync(500) })
  expect(writes).toEqual([
    { provider: 'a', script: 'first-a', expectedRevision: 0 },
    { provider: 'b', script: 'only-b', expectedRevision: 0 },
    { provider: 'a', script: 'latest-a', expectedRevision: 1 },
  ])
  expect(onBusyChange).toHaveBeenLastCalledWith(false)
  expect(screen.queryByRole('button', { name: '保存' })).toBeNull()
})

it('persists invalid edits and clears configuration through the same autosave path', async () => {
  vi.useFakeTimers()
  const writes: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
    if (!init) return response(snapshot('a'))
    const body = JSON.parse(init.body as string) as { script: string; expectedRevision: number }
    writes.push(body.script)
    return response(snapshot('a', body.script, body.expectedRevision + 1, body.script ? 'invalid' : 'unconfigured'))
  }))
  render(<BalanceScriptEditor provider="a" t={t} onBusyChange={vi.fn()} />)
  await act(async () => {})
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'invalid source' } })
  await act(async () => { await vi.advanceTimersByTimeAsync(500) })
  expect(screen.getByRole('alert').textContent).toBe(zh.balanceInvalid)
  expect(screen.getByRole<HTMLTextAreaElement>('textbox').value).toBe('invalid source')
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '' } })
  await act(async () => { await vi.advanceTimersByTimeAsync(500) })
  expect(screen.getByText(zh.balanceUnconfigured)).toBeTruthy()
  expect(writes).toEqual(['invalid source', ''])
})

it('retains conflicting input without repeatedly overwriting a newer revision', async () => {
  vi.useFakeTimers()
  const fetcher = vi.fn(async (_url: string, init?: RequestInit) => init ? response({}, 409) : response(snapshot('a')))
  vi.stubGlobal('fetch', fetcher)
  render(<BalanceScriptEditor provider="a" t={t} onBusyChange={vi.fn()} />)
  await act(async () => {})
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'my edit' } })
  await act(async () => { await vi.advanceTimersByTimeAsync(500) })
  expect(screen.getByRole('alert').textContent).toContain(zh.balanceConflict)
  expect(screen.getByRole<HTMLTextAreaElement>('textbox').value).toBe('my edit')
  await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
  expect(fetcher).toHaveBeenCalledTimes(2)
})

it('shows an unapproved endpoint, approves it and leaves the saved script alone', async () => {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init })
    const pending = { provider: 'a', script: 'adapter', revision: 3, request: { path: '/v1/usage', method: 'GET' } }
    return init === undefined ? response({ ...pending, status: 'unapproved' }) : response({ ...pending, status: 'valid' })
  }))
  render(<BalanceScriptEditor provider="a" t={t} onBusyChange={vi.fn()} />)
  await act(async () => {})
  expect(screen.getByText(new RegExp(zh.balanceUnapproved)).textContent).toContain('GET /v1/usage')
  fireEvent.click(screen.getByRole('button', { name: zh.balanceApprove }))
  await act(async () => {})
  expect(calls[1]?.url).toBe('/api/token-monitor/balance-endpoint?provider=a')
  expect(calls[1]?.init?.method).toBe('PUT')
  expect(JSON.parse(calls[1]?.init?.body as string)).toEqual({ path: '/v1/usage', method: 'GET' })
  expect(screen.queryByRole('button', { name: zh.balanceApprove })).toBeNull()
  expect(screen.getByText(zh.balanceValid)).toBeTruthy()
})

it('shows a shipped adapter as ready without asking the user to configure it', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => response({
    provider: 'fast', script: 'adapter', revision: 0, status: 'valid', source: 'built-in', adapter: 'fastaitoken',
    request: { path: '/v1/usage', method: 'GET' },
  })))
  render(<BalanceScriptEditor provider="fast" t={t} onBusyChange={vi.fn()} />)
  await act(async () => {})
  expect(screen.getByText(new RegExp(zh.balanceValid))).toBeTruthy()
  expect(screen.getByText(new RegExp(zh.balanceBuiltIn)).textContent).toContain('fastaitoken')
  expect(screen.queryByRole('button', { name: zh.balanceApprove })).toBeNull()
})
