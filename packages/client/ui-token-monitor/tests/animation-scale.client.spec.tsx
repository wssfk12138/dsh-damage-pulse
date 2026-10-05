// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_TOKEN_MONITOR_SETTINGS, TOKEN_MONITOR_SETTINGS_SCHEMA_VERSION } from '@deepseek-ai/dsh-token-monitor-contract'
import { BalanceWidget } from '../src/client/BalanceWidget.tsx'
import type { ComponentProps } from 'react'
const config = vi.hoisted(() => ({ ratio: 0.8, failure: false }))
vi.mock('../src/client/WhaleGirlStage.tsx', () => ({ WhaleGirlStage: () => <canvas /> }))
vi.mock('../src/client/settingsApi.ts', async importOriginal => ({
  ...await importOriginal<typeof import('../src/client/settingsApi.ts')>(),
  createTokenMonitorSettingsApi: () => ({ get: async () => {
    if (config.failure) throw new Error('temporary failure')
    return { schemaVersion: TOKEN_MONITOR_SETTINGS_SCHEMA_VERSION, revision: 1, settings: { ...DEFAULT_TOKEN_MONITOR_SETTINGS, animationScale: config.ratio } }
  } }),
}))
afterEach(() => { cleanup(); localStorage.clear(); vi.useRealTimers(); vi.unstubAllGlobals(); config.ratio = 0.8; config.failure = false })
describe('card animation proportions', () => {
  it('scales whale and live damage together across card sizes and a background override', async () => {
    vi.useFakeTimers()
    const observers = new Map<Element, Set<(entries: unknown[]) => void>>()
    const resized = (entries: unknown[]) => {
      const card = document.querySelector('[aria-label^="DeepSeek 账户余额"]')!
      for (const callback of observers.get(card) ?? []) callback(entries)
    }
    vi.stubGlobal('ResizeObserver', class {
      constructor(private callback: (entries: unknown[]) => void) {}
      observe(node: Element) {
        const callbacks = observers.get(node) ?? new Set()
        callbacks.add(this.callback)
        observers.set(node, callbacks)
      }
      disconnect() { for (const callbacks of observers.values()) callbacks.delete(this.callback) }
    })
    let chargeCalls = 0
    const provider = 'deepseek-official', model = 'deepseek-flash'
    const billing = { snapshot: { revision: 1, rules: { version: 1, providers: [{ provider, enabled: true, models: [{ model, enabled: true }] }] } }, invalid: false }
    vi.stubGlobal('fetch', vi.fn(async (input: string) => {
      let body: unknown = null
      if (input.includes('/balance?')) body = { totalBalance: 10, currency: 'CNY' }
      if (input.includes('/charge-events')) { chargeCalls++; body = { streamId: 'ratio', seq: chargeCalls > 1 ? 1 : 0, events: chargeCalls === 2 ? [{ id: 'damage', seq: 1, cost: 0.02, damageKind: 'normal', provider, model, sourceEvent: { sessionId: 'ratio', seq: 1 } }] : [] } }
      return new Response(JSON.stringify(body))
    }))
    const props: ComponentProps<typeof BalanceWidget> = {
      useSessions: vi.fn().mockImplementation((select: (state: unknown) => unknown) => select({ byId: {} })),
      loadDisplayScope: vi.fn().mockResolvedValue({ provider, model, sessionId: 'ratio' }),
      useBillingEvents: vi.fn().mockImplementation((select: (state: unknown) => unknown) => select(billing)),
      t: vi.fn().mockImplementation((key: string) => key),
    }
    render(<BalanceWidget {...props} />)
    await act(async () => {})
    await act(async () => { await vi.advanceTimersByTimeAsync(600) })
    const whale = () => document.querySelector<HTMLElement>('[data-token-monitor-whale-layer]')!
    const damage = () => document.querySelector<HTMLElement>('[data-charge-event-id^="damage-"]')!
    expect(whale().style.width).toBe('80%')
    expect(whale().style.aspectRatio).toBe('1 / 1')
    await act(async () => { resized([{ borderBoxSize: [{ inlineSize: 200 }], contentRect: { width: 184 } }]); await vi.advanceTimersByTimeAsync(1_000) })
    expect(damage()).not.toBeNull()
    expect(parseFloat(damage().style.fontSize)).toBeCloseTo(16)
    await act(async () => { resized([{ borderBoxSize: [{ inlineSize: 400 }], contentRect: { width: 384 } }]) })
    expect(parseFloat(damage().style.fontSize)).toBeCloseTo(32)
    config.ratio = 0.6
    await act(async () => { window.dispatchEvent(new Event('focus')) })
    expect(whale().style.width).toBe('60%')
    expect(parseFloat(damage().style.fontSize)).toBeCloseTo(24)
    config.failure = true
    await act(async () => { window.dispatchEvent(new Event('focus')) })
    expect(whale().style.width).toBe('60%')
    await act(async () => { resized([{ borderBoxSize: [{ inlineSize: 100 }], contentRect: { width: 84 } }]) })
    expect(parseFloat(damage().style.fontSize)).toBeCloseTo(6)
  })
})
