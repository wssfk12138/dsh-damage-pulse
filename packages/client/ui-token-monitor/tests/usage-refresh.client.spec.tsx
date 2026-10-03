// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { StrictMode } from 'react'
import { UsageDetailsWindow } from '../src/client/UsageDetailsWindow.tsx'
import { UsageOverview } from '../src/client/UsageOverview.tsx'
import { zh, type DetailTranslate } from '../src/client/detail-locales.ts'

const t: DetailTranslate = (key, values) => Object.entries(values ?? {}).reduce((text, [name, value]) => text.replace('{' + name + '}', String(value)), zh[key] as string)
const time = Date.parse('2026-10-02T02:00:00Z')
const response = (value: unknown, status = 200) => ({ ok: status === 200, status, json: async () => value })
function summary(url: string, value = 1) {
  return { range: new URL(url, 'http://localhost').searchParams.get('range'), from: null, to: null, spendCny: value, requestCount: value, totalTokens: value * 420000, activeDays: 1, cacheHitTokens: value * 200000, cacheHitRate: 0.5, costPer100mTokensCny: 10, activeDaySpendCny: value }
}
function details(url: string, value = 1) {
  const query = new URL(url, 'http://localhost').searchParams
  return { snapshot: query.get('snapshot') ?? 'snapshot-' + value, capturedAt: time, page: Number(query.get('page')), pages: 3, total: 43 + value, size: 20, providers: ['fixture'], models: ['model-' + value], sessions: [],
    rows: [{ id: 'row-' + value, sessionId: 'root', provider: 'fixture', model: 'model-' + value, status: 'success', timestamp: time, cost: value, inputTokens: 100000, outputTokens: 70000 }] }
}
type Fetcher = (url: string, init: RequestInit) => Promise<ReturnType<typeof response>>
function mount(implementation: Fetcher = async url => response(url.includes('usage-summary') ? summary(url) : details(url)), strict = false) {
  const fetcher = vi.fn(implementation)
  vi.stubGlobal('fetch', fetcher)
  const view = <UsageDetailsWindow t={t} onClose={() => {}} />
  const result = render(strict ? <StrictMode>{view}</StrictMode> : view)
  return { ...result, fetcher }
}
const flush = async () => { await act(async () => {}) }
const tick = async (ms: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms) }) }
const urls = (fetcher: ReturnType<typeof vi.fn>, endpoint: string) => fetcher.mock.calls.filter(([url]) => String(url).includes(endpoint)).map(([url]) => String(url))
function visible(state: 'visible' | 'hidden') { Object.defineProperty(document, 'visibilityState', { configurable: true, value: state }); fireEvent(document, new Event('visibilitychange')) }
beforeEach(() => { vi.useFakeTimers(); Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' }) })
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); localStorage.clear(); Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' }) })

it('AC-R01/R02: immediately loads both endpoints, polls after completion, refreshes first-page snapshots and retains both displays in flight', async () => {
  let value = 1, resolveDetail!: (value: ReturnType<typeof response>) => void
  const { fetcher } = mount(async url => url.includes('usage-summary') ? response(summary(url, value)) : value === 2 ? await new Promise(resolve => { resolveDetail = resolve }) : response(details(url, value)))
  await flush()
  expect(fetcher).toHaveBeenCalledTimes(2)
  expect(screen.getByText('¥1.000000')).toBeTruthy()
  value = 2
  await tick(1999); expect(fetcher).toHaveBeenCalledTimes(2)
  await tick(1); expect(fetcher).toHaveBeenCalledTimes(4)
  expect(screen.getByText('¥1.000000')).toBeTruthy()
  expect(within(screen.getByRole('region', { name: '数据概览' })).getByText('¥2')).toBeTruthy()
  expect(screen.queryByText('正在加载…')).toBeNull()
  await tick(10000); expect(fetcher).toHaveBeenCalledTimes(4)
  await act(async () => { resolveDetail(response(details(urls(fetcher, '/details?').at(-1)!, 2))) })
  expect(screen.getByText('¥2.000000')).toBeTruthy()
  value = 3
  await tick(2000)
  expect(fetcher).toHaveBeenCalledTimes(6)
  expect(urls(fetcher, '/details?').every(url => !url.includes('snapshot='))).toBe(true)
  expect(vi.getTimerCount()).toBe(1)
})

it('AC-R03/R04: history rows, snapshot, page and scroll stay fixed; both manual buttons refresh both endpoints to page one', async () => {
  let value = 1
  const { fetcher } = mount(async url => response(url.includes('usage-summary') ? summary(url, value) : details(url, value)))
  await flush()
  fireEvent.click(screen.getByRole('button', { name: '下一页' })); await flush()
  const historical = urls(fetcher, '/details?').at(-1)!
  expect(historical).toContain('page=2'); expect(historical).toContain('snapshot=snapshot-1')
  const scroller = screen.getByRole('table').parentElement!
  scroller.scrollTop = 83
  const calls = urls(fetcher, '/details?').length
  value = 2; await tick(6000)
  expect(urls(fetcher, '/details?')).toHaveLength(calls)
  expect(screen.getByText('¥1.000000')).toBeTruthy()
  expect(screen.getByText(/第 2 \/ 3 页/)).toBeTruthy()
  expect(scroller.scrollTop).toBe(83)
  expect(screen.getByText(zh.historicalSnapshot)).toBeTruthy()
  for (const name of ['刷新概览', '刷新']) {
    const before = fetcher.mock.calls.length
    fireEvent.click(screen.getByRole('button', { name })); await flush()
    expect(fetcher).toHaveBeenCalledTimes(before + 2)
    const latest = urls(fetcher, '/details?').at(-1)!
    expect(latest).toContain('page=1'); expect(latest).not.toContain('snapshot=')
    expect(screen.getByText('¥2.000000')).toBeTruthy()
  }
})

it('AC-R05/R08: newer shared-filter generation wins even if old fetch ignores abort; rapid refresh cannot overwrite the latest view', async () => {
  const pending: { url: string; signal: AbortSignal; resolve: (value: ReturnType<typeof response>) => void }[] = []
  const { fetcher } = mount(async (url, init) => await new Promise(resolve => { pending.push({ url, signal: init.signal as AbortSignal, resolve }) }))
  fireEvent.click(within(screen.getByRole('region', { name: '数据概览' })).getByRole('button', { name: '7天' }))
  expect(pending.slice(0, 2).every(item => item.signal.aborted)).toBe(true)
  await act(async () => { pending.slice(2).forEach(item => item.resolve(response(item.url.includes('usage-summary') ? summary(item.url, 7) : details(item.url, 7)))) })
  expect(screen.getByText('¥7.000000')).toBeTruthy()
  await act(async () => { pending.slice(0, 2).forEach(item => item.resolve(response(item.url.includes('usage-summary') ? summary(item.url, 1) : details(item.url, 1)))) })
  expect(screen.queryByText('¥1.000000')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '刷新' })); fireEvent.click(screen.getByRole('button', { name: '刷新概览' }))
  expect(pending.slice(4, 6).every(item => item.signal.aborted)).toBe(true)
  await act(async () => { pending.slice(6).forEach(item => item.resolve(response(item.url.includes('usage-summary') ? summary(item.url, 9) : details(item.url, 9)))) })
  expect(screen.getByText('¥9.000000')).toBeTruthy()
  await tick(1999); expect(fetcher).toHaveBeenCalledTimes(8)
  await act(async () => { pending.slice(4, 6).forEach(item => item.resolve(response(item.url.includes('usage-summary') ? summary(item.url, 8) : details(item.url, 8)))) })
  expect(screen.queryByText('¥8.000000')).toBeNull()
})

it('AC-R06: exclusive filters do not refetch summary; provider/time changes update both and never carry old snapshots', async () => {
  const { fetcher } = mount(); await flush()
  for (const [label, value] of [['模型', 'another'], ['对话', 'root'], ['项目', 'project']]) { fireEvent.change(screen.getByLabelText(label!), { target: { value } }); await flush() }
  fireEvent.click(screen.getByRole('button', { name: '错误请求' })); await flush()
  expect(urls(fetcher, 'usage-summary')).toHaveLength(1)
  fireEvent.change(screen.getByLabelText('Provider'), { target: { value: 'fixture' } }); await flush()
  expect(urls(fetcher, 'usage-summary')).toHaveLength(2)
  expect(urls(fetcher, 'usage-summary').at(-1)).toContain('provider=fixture')
  expect(urls(fetcher, '/details?').at(-1)).toContain('provider=fixture')
  fireEvent.click(within(screen.getByRole('region', { name: '数据概览' })).getByRole('button', { name: '昨日' })); await flush()
  expect(urls(fetcher, 'usage-summary').at(-1)).toContain('range=yesterday')
  expect(urls(fetcher, '/details?').at(-1)).toContain('range=yesterday')
  expect(urls(fetcher, '/details?').every(url => !url.includes('snapshot='))).toBe(true)
})

it('AC-R07: hidden/unmount abort pending work; visibility immediately resumes; three StrictMode mount cycles leave no timers/listeners', async () => {
  const add = vi.spyOn(document, 'addEventListener'), remove = vi.spyOn(document, 'removeEventListener')
  for (let cycle = 0; cycle < 3; cycle++) {
    const pending: { signal: AbortSignal; resolve: (value: ReturnType<typeof response>) => void }[] = []
    const { fetcher, unmount } = mount(async (_url, init) => await new Promise(resolve => { pending.push({ signal: init.signal as AbortSignal, resolve }) }), true)
    expect(pending.filter(item => !item.signal.aborted)).toHaveLength(2)
    visible('hidden'); await flush()
    expect(pending.every(item => item.signal.aborted)).toBe(true)
    const calls = fetcher.mock.calls.length
    await tick(10000); expect(fetcher).toHaveBeenCalledTimes(calls)
    visible('visible'); await flush(); expect(fetcher).toHaveBeenCalledTimes(calls + 2)
    unmount(); expect(pending.every(item => item.signal.aborted)).toBe(true)
    await act(async () => { pending.forEach(item => item.resolve(response({}))) })
    expect(vi.getTimerCount()).toBe(0)
  }
  expect(add.mock.calls.filter(([event]) => event === 'visibilitychange')).toHaveLength(remove.mock.calls.filter(([event]) => event === 'visibilitychange').length)
})

it('AC-R09: network/5xx retain successful values, use bounded 2/4/8/16/30-second backoff and recover normal frequency', async () => {
  let fail = false, network = false
  const { fetcher } = mount(async url => { if (network) throw new Error('offline'); return fail ? response({}, 503) : response(url.includes('usage-summary') ? summary(url) : details(url)) }); await flush()
  fail = true; await tick(2000)
  expect(screen.getByText('¥1.000000')).toBeTruthy()
  expect(screen.getAllByText(/保留上次成功数据/)).toHaveLength(2)
  for (const delay of [2000, 4000, 8000, 16000, 30000, 30000]) {
    const calls = fetcher.mock.calls.length
    await tick(delay - 1); expect(fetcher).toHaveBeenCalledTimes(calls)
    await tick(1); expect(fetcher).toHaveBeenCalledTimes(calls + 2)
  }
  network = true; await tick(30000); expect(screen.getByText('¥1.000000')).toBeTruthy()
  fail = false; network = false
  fireEvent.click(screen.getByRole('button', { name: '刷新' })); await flush()
  expect(screen.queryByRole('alert')).toBeNull()
  const calls = fetcher.mock.calls.length
  await tick(2000); expect(fetcher).toHaveBeenCalledTimes(calls + 2)
})

it.each(['network', 'server', 'malformed'] as const)('AC-R09: first %s failure reports unavailable data, never fabricated zero, and retries both endpoints', async failure => {
  let fail = true
  const { fetcher } = mount(async url => {
    if (fail && failure === 'network') throw new Error('offline')
    return fail ? response({}, failure === 'server' ? 503 : 200) : response(url.includes('usage-summary') ? summary(url, 2) : details(url, 2))
  })
  await flush()
  expect(screen.getAllByRole('alert')).toHaveLength(2)
  expect(screen.queryByText('¥0')).toBeNull()
  expect(screen.queryByText(zh.empty)).toBeNull()
  expect(screen.queryByText(/保留上次成功数据/)).toBeNull()
  await tick(1999); expect(fetcher).toHaveBeenCalledTimes(2)
  fail = false
  await tick(1); expect(fetcher).toHaveBeenCalledTimes(4)
  expect(screen.getByText('¥2.000000')).toBeTruthy()
  expect(screen.queryByRole('alert')).toBeNull()
})

it('AC-R09: malformed successful responses retain same-scope data and never expose server content', async () => {
  let fail = false
  mount(async url => response(fail ? { message: 'private-server-content' } : url.includes('usage-summary') ? summary(url) : details(url)))
  await flush()
  fail = true; await tick(2000)
  expect(screen.getByText('¥1.000000')).toBeTruthy()
  expect(screen.getAllByText(/保留上次成功数据/)).toHaveLength(2)
  expect(screen.queryByText('private-server-content')).toBeNull()
})

it.each([401, 403])('AC-R10: HTTP %s pauses the protected chain, including visibility resumes, until explicit user retry', async status => {
  let fail = true
  const { fetcher } = mount(async url => fail ? response({}, status) : response(url.includes('usage-summary') ? summary(url) : details(url))); await flush()
  expect(screen.getAllByText(zh.authorizationExpired)).toHaveLength(2)
  const calls = fetcher.mock.calls.length
  await tick(120000); visible('hidden'); visible('visible'); await flush()
  expect(fetcher).toHaveBeenCalledTimes(calls)
  expect(screen.queryByText('¥0')).toBeNull()
  fail = false; fireEvent.click(screen.getByRole('button', { name: '刷新概览' })); await flush()
  expect(screen.getByText('¥1.000000')).toBeTruthy()
  expect(screen.queryByRole('alert')).toBeNull()
})

it('AC-R11: historical 409 is explicit and does not silently switch snapshot/page or fabricate empty results', async () => {
  const { fetcher } = mount(async url => url.includes('usage-summary') ? response(summary(url)) : url.includes('page=2') ? response({}, 409) : response(details(url))); await flush()
  fireEvent.click(screen.getByRole('button', { name: '下一页' })); await flush()
  expect(screen.getByText(zh.expired)).toBeTruthy()
  expect(screen.queryByText(zh.empty)).toBeNull()
  expect(screen.getByText("第 2 页 · 总页数与条数暂不可用")).toBeTruthy()
  expect(screen.queryByText(/共 0 条/)).toBeNull()
  const calls = urls(fetcher, '/details?').length
  await tick(10000); expect(urls(fetcher, '/details?')).toHaveLength(calls)
  expect(urls(fetcher, '/details?').at(-1)).toContain('page=2')
  fireEvent.click(screen.getByRole('button', { name: '刷新' })); await flush()
  expect(urls(fetcher, '/details?').at(-1)).toContain('page=1')
  expect(urls(fetcher, '/details?').at(-1)).not.toContain('snapshot=')
  expect(screen.queryByText(zh.expired)).toBeNull()
})

it('AC-R12/R06: standalone has one poller and explicit custom ranges use identical inclusive-second endpoints', async () => {
  const fetcher = vi.fn(async (url: string) => response(summary(url)))
  vi.stubGlobal('fetch', fetcher)
  const view = render(<UsageOverview t={t} compact={false} />); await flush()
  expect(fetcher).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(1)
  await tick(2000); expect(fetcher).toHaveBeenCalledTimes(2)
  view.unmount(); expect(vi.getTimerCount()).toBe(0)
  const window = mount(); await flush()
  fireEvent.change(screen.getByLabelText('开始时间'), { target: { value: '2026-10-01T00:00:00' } })
  fireEvent.change(screen.getByLabelText('结束时间'), { target: { value: '2026-10-01T23:59:59' } })
  fireEvent.click(screen.getByRole('button', { name: '应用时间' })); await flush()
  const queries = [urls(window.fetcher, 'usage-summary').at(-1)!, urls(window.fetcher, '/details?').at(-1)!].map(url => new URL(url, 'http://localhost').searchParams)
  expect(queries.map(query => [query.get('from'), query.get('to')])).toEqual(Array(2).fill([String(Date.parse('2026-09-30T16:00:00Z')), String(Date.parse('2026-10-01T15:59:59.999Z'))]))
})
