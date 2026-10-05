// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { BalanceScriptEditor } from '../src/client/BalanceScriptEditor.tsx'
import { zh, type DetailTranslate } from '../src/client/detail-locales.ts'

const t: DetailTranslate = key => zh[key]
const snapshot = (provider: string, script = '', revision = 0, status = 'unconfigured') => ({ provider, script, revision, status })
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
const nativeSnapshot = (enabled: boolean, revision = 0) => ({ provider: 'deepseek-account', script: '', source: 'native-account', enabled, revision, status: enabled ? 'valid' : 'unconfigured' })
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals() })

it('shows the native source and autosaves pause/resume without a script editor', async () => {
  vi.useFakeTimers()
  const writes: unknown[] = []
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
    if (!init) return response(nativeSnapshot(true))
    const body = JSON.parse(init.body as string)
    writes.push(body)
    return response(nativeSnapshot(body.enabled, body.expectedRevision + 1))
  }))
  render(<BalanceScriptEditor provider="deepseek-account" t={t} onBusyChange={vi.fn()} />)
  await act(async () => {})
  expect(screen.queryByRole('textbox')).toBeNull()
  expect(screen.getByText(zh.balanceNativeSource)).toBeTruthy()
  const toggle = screen.getByRole<HTMLInputElement>('checkbox')
  expect(toggle.checked).toBe(true)
  fireEvent.click(toggle)
  await act(async () => { await vi.advanceTimersByTimeAsync(500) })
  expect(screen.getByText(zh.balanceNativePaused)).toBeTruthy()
  fireEvent.click(toggle)
  await act(async () => { await vi.advanceTimersByTimeAsync(500) })
  expect(screen.getByText(zh.balanceNativeActive)).toBeTruthy()
  expect(writes).toEqual([{ enabled: false, expectedRevision: 0 }, { enabled: true, expectedRevision: 1 }])
})

it.each([409, 500])('retains native switch drafts on HTTP %i without blind retries', async status => {
  vi.useFakeTimers()
  const fetcher = vi.fn(async (_url: string, init?: RequestInit) => init ? response({}, status) : response(nativeSnapshot(true)))
  vi.stubGlobal('fetch', fetcher)
  render(<BalanceScriptEditor provider="deepseek-account" t={t} onBusyChange={vi.fn()} />)
  await act(async () => {})
  fireEvent.click(screen.getByRole('checkbox'))
  await act(async () => { await vi.advanceTimersByTimeAsync(500) })
  expect(screen.getByRole<HTMLInputElement>('checkbox').checked).toBe(false)
  expect(screen.getByRole('alert').textContent).toContain(status === 409 ? zh.balanceConflict : zh.billingSaveFailed)
  await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
  expect(fetcher).toHaveBeenCalledTimes(2)
  if (status === 409) {
    expect(screen.getByRole<HTMLInputElement>('checkbox').disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: zh.billingLoadLatest }))
    await act(async () => {})
    expect(screen.getByRole<HTMLInputElement>('checkbox').checked).toBe(true)
  } else {
    fireEvent.click(screen.getByRole('button', { name: zh.balanceRetry }))
    await act(async () => {})
    expect(fetcher).toHaveBeenCalledTimes(3)
  }
})

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
