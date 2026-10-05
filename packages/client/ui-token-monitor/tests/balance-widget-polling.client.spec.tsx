// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { BalanceWidget } from '../src/client/BalanceWidget.tsx'
import { BalanceRegistry } from '../../../../plugins/dsh-token-monitor/src/balance-registry.ts'
import { evaluateBalanceScript, OFFICIAL_BALANCE_SCRIPT } from '../../../../plugins/dsh-token-monitor/src/balance-script.ts'

// Initialize WASM with the real clock before measuring network/polling cadence.
beforeAll(async () => { await evaluateBalanceScript(OFFICIAL_BALANCE_SCRIPT) })
beforeEach(() => { vi.useFakeTimers(); window.localStorage.clear() })
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks() })

function mount(delay: number, fail = false) {
  const starts: number[] = []
  const signals: AbortSignal[] = []
  const origin = Date.now()
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    if (!String(input).startsWith('/api/token-monitor/balance?')) return new Response('', { status: 503 })
    starts.push(Date.now() - origin)
    signals.push(init?.signal as AbortSignal)
    await new Promise(resolve => setTimeout(resolve, delay))
    if (fail) throw new Error('offline')
    return new Response(JSON.stringify({ provider: 'deepseek-account', currency: 'CNY', totalBalance: 123.45, updatedAt: Date.now() }))
  })
  const props = {
    useSessions: (selector: (state: { current: string }) => unknown) => selector({ current: 'session-1' }),
    loadDisplayScope: vi.fn().mockResolvedValue({ sessionId: 'session-1', provider: 'deepseek-account', model: 'deepseek-chat' }),
  } as unknown as ComponentProps<typeof BalanceWidget>
  return { view: render(<BalanceWidget {...props} />), starts, signals }
}

describe('balance polling cadence', () => {
  it('queries the real API-key registry each cycle despite 200ms response latency', async () => {
    const starts: number[] = []
    const origin = Date.now()
    const registry = new BalanceRegistry({
      readScript: async () => ({ provider: 'deepseek-official', revision: 0, status: 'valid', script: OFFICIAL_BALANCE_SCRIPT, request: { path: '/user/balance', method: 'GET', auth: 'bearer' } }),
      resolveIdentity: async () => ({ apiKey: 'synthetic', baseURL: 'https://api.deepseek.com' }),
      request: async () => { starts.push(Date.now() - origin); await new Promise(resolve => setTimeout(resolve, 200)); return { balance_infos: [{ currency: 'CNY', total_balance: '123.45', granted_balance: '3.45', topped_up_balance: '120' }] } },
    })
    vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
      if (!String(input).startsWith('/api/token-monitor/balance?')) return new Response('', { status: 503 })
      return new Response(JSON.stringify(await registry.get('deepseek-official') ?? null))
    })
    const props = { useSessions: (selector: (state: { current: string }) => unknown) => selector({ current: 'session-1' }), loadDisplayScope: vi.fn().mockResolvedValue({ sessionId: 'session-1', provider: 'deepseek-official', model: 'deepseek-chat' }) } as unknown as ComponentProps<typeof BalanceWidget>
    const view = render(<BalanceWidget {...props} />)
    await act(async () => {})
    await act(async () => { await vi.advanceTimersByTimeAsync(61_000) })
    expect(starts).toHaveLength(5)
    expect(starts.slice(1).every((at, i) => at - starts[i] >= 15_000 && at - starts[i] < 16_000)).toBe(true)
    view.unmount()
    await registry.stop()
  })
  it('starts every 15 seconds, not 15 seconds after a delayed response, and stops on unmount', async () => {
    const { view, starts, signals } = mount(2_000)
    await act(async () => {})
    await act(async () => { await vi.advanceTimersByTimeAsync(46_000) })
    expect(starts).toEqual([0, 15_000, 30_000, 45_000])
    expect(document.querySelector('[data-token-monitor-display]')?.textContent).toContain('123.45')
    view.unmount()
    expect(signals.every(signal => signal.aborted)).toBe(true)
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })
    expect(starts).toHaveLength(4)
  })
  it('continues fixed-interval retries after a failure', async () => {
    const { starts } = mount(2_000, true)
    await act(async () => {})
    await act(async () => { await vi.advanceTimersByTimeAsync(46_000) })
    expect(starts).toEqual([0, 15_000, 30_000, 45_000])
  })
  it('does not overlap a request that takes longer than 15 seconds', async () => {
    const { starts } = mount(20_000)
    await act(async () => {})
    await act(async () => { await vi.advanceTimersByTimeAsync(46_000) })
    expect(starts).toEqual([0, 30_000])
  })
})
