// @vitest-environment jsdom

/**
 * The floating card presents the account balance as a health bar: the fill is the
 * balance measured against a configurable "full HP" ceiling, so spending drains it
 * and a top-up refills it. These tests pin the ratio, the over-full clamp, the
 * healthy / low / critical / empty tiers, the exact readout kept next to the bar,
 * and the unavailable state where no bar may be implied.
 */
import { act, cleanup, render, waitFor } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/** Mutable per-test Host state: the settings endpoint and the balance endpoint read it. */
const state = vi.hoisted(() => ({
  balance: 80,
  balanceOk: true,
  healthBarMaxCny: 100,
  damageEffectLevel: 'normal' as string,
}))

vi.mock('../src/client/settingsApi.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/client/settingsApi.ts')>()
  const contract = await import('../../../util/token-monitor-contract/src/index.ts')
  const fetcher = async (): Promise<Response> => new Response(JSON.stringify({
    schemaVersion: contract.TOKEN_MONITOR_SETTINGS_SCHEMA_VERSION,
    revision: 1,
    settings: {
      ...contract.DEFAULT_TOKEN_MONITOR_SETTINGS,
      healthBarMaxCny: state.healthBarMaxCny,
      damageEffectLevel: state.damageEffectLevel,
    },
  }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  return {
    ...actual,
    createTokenMonitorSettingsApi: () => actual.createTokenMonitorSettingsApi(fetcher),
  }
})

const { BalanceWidget } = await import('../src/client/BalanceWidget.tsx')

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

function balanceBody(totalBalance: number) {
  return {
    currency: 'CNY',
    totalBalance,
    grantedBalance: 0,
    toppedUpBalance: totalBalance,
    isAvailable: true,
    updatedAt: 1,
  }
}

/** Shake keyframes are the only animation that swings single-axis on x, so they are identifiable. */
const shakeCalls: Keyframe[][] = []

beforeEach(() => {
  window.localStorage.clear()
  state.balance = 80
  state.balanceOk = true
  state.healthBarMaxCny = 100
  state.damageEffectLevel = 'normal'
  shakeCalls.length = 0
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  })
  Object.defineProperty(Element.prototype, 'getAnimations', { configurable: true, writable: true, value: () => [] })
  Object.defineProperty(Element.prototype, 'animate', {
    configurable: true,
    writable: true,
    value: function (this: Element, keyframes: Keyframe[]) {
      const swing = keyframes[1]?.transform
      if (typeof swing === 'string' && /^translate3d\(-[\d.]+px,0,0\)$/.test(swing)) shakeCalls.push(keyframes)
      return { cancel() {}, commitStyles() {} }
    },
  })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

/** Widget props: route-eligible and session-bound, exactly as the host overlay seat provides them. */
function widgetProps(): ComponentProps<typeof BalanceWidget> {
  const useSessions = (selector: (value: { current: string }) => unknown) => selector({ current: 'session-1' })
  return { useSessions, loadRouteEligibility: vi.fn().mockResolvedValue(true) } as unknown as ComponentProps<typeof BalanceWidget>
}

async function mountWidget(): Promise<ReturnType<typeof render>> {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input)
    if (url.startsWith('/api/token-monitor/charge-events')) {
      return json({ streamId: 'stream-1', seq: 0, firstSeq: 0, dropped: false, events: [] })
    }
    if (url.startsWith('/api/token-monitor/balance')) {
      if (!state.balanceOk) return new Response('', { status: 503 })
      return json(balanceBody(state.balance))
    }
    return new Response('', { status: 503 })
  })
  const view = render(<BalanceWidget {...widgetProps()} />)
  await waitFor(() => { expect(view.baseElement.querySelector('[data-token-monitor-balance]')).not.toBeNull() })
  return view
}

function bar(view: ReturnType<typeof render>): HTMLElement | null {
  return view.baseElement.querySelector('[data-token-monitor-health-bar]')
}

function fill(view: ReturnType<typeof render>): HTMLElement | null {
  return view.baseElement.querySelector('[data-health-fill]')
}

function fillWidth(view: ReturnType<typeof render>): string | undefined {
  return fill(view)?.style.width
}

function fillBackground(view: ReturnType<typeof render>): string {
  return fill(view)?.style.background ?? ''
}

function burst(view: ReturnType<typeof render>): HTMLElement | null {
  return view.baseElement.querySelector('[data-health-burst]')
}

function burstMagnitude(view: ReturnType<typeof render>): number {
  return Number(burst(view)?.getAttribute('data-health-burst-magnitude') ?? '0')
}

/** The burst layer holds one shockwave ring plus the sparks. */
function burstSparkCount(view: ReturnType<typeof render>): number {
  return (burst(view)?.querySelectorAll('span').length ?? 0) - 1
}

/** Amplitude of the most recent health-bar shake, read back from its keyframes. */
function lastShakeAmplitude(): number {
  const swing = shakeCalls.at(-1)?.[1]?.transform
  const match = typeof swing === 'string' ? /-([\d.]+)px/.exec(swing) : null
  return match === null ? 0 : Number(match[1])
}

function readout(view: ReturnType<typeof render>): string {
  return view.baseElement.querySelector('[data-token-monitor-display]')?.textContent ?? ''
}

type Charge = { id: string; seq: number; cost: number; kind: 'hit' | 'output' | 'miss' }

/**
 * Mount with a charge-event stream instead of a static one, so a test can decide
 * when a debit lands. Fake timers drive the 1s poll interval.
 */
async function mountWithCharges(charges: Charge[]): Promise<ReturnType<typeof render>> {
  vi.useFakeTimers()
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input)
    if (url.startsWith('/api/token-monitor/charge-events')) {
      const since = Number(new URL(url, 'http://x').searchParams.get('since') ?? '0')
      return json({
        streamId: 'stream-1',
        seq: charges.length,
        firstSeq: charges.length === 0 ? 0 : 1,
        dropped: false,
        events: charges.filter(charge => charge.seq > since),
      })
    }
    if (url.startsWith('/api/token-monitor/balance')) return json(balanceBody(state.balance))
    return new Response('', { status: 503 })
  })
  return render(<BalanceWidget {...widgetProps()} />)
}

/**
 * Mount, let the first poll seed the charge cursor, land one charge, and let the next
 * poll emit it. Returns the shake amplitude captured for that single hit.
 */
async function mountWithCharge(charge: Omit<Charge, 'id' | 'seq'>): Promise<{
  view: ReturnType<typeof render>
  shakeAmplitude: number
}> {
  const charges: Charge[] = []
  const view = await mountWithCharges(charges)
  await act(async () => { await vi.advanceTimersByTimeAsync(1_000) })
  charges.push({ id: 'charge-1', seq: 1, ...charge })
  await act(async () => { await vi.advanceTimersByTimeAsync(1_000) })
  return { view, shakeAmplitude: lastShakeAmplitude() }
}

describe('BalanceWidget health bar', () => {
  it('fills the bar with the balance measured against the default ceiling', async () => {
    const view = await mountWidget()

    await waitFor(() => { expect(fillWidth(view)).toBe('80%') })
    const element = bar(view)
    expect(element?.getAttribute('role')).toBe('progressbar')
    expect(element?.getAttribute('aria-valuemin')).toBe('0')
    expect(element?.getAttribute('aria-valuemax')).toBe('100')
    expect(element?.getAttribute('aria-valuenow')).toBe('80')
    expect(element?.getAttribute('aria-valuetext')).toBe('CNY 80.00 / 100.00')
    expect(element?.getAttribute('data-health-state')).toBe('healthy')
    // The exact amounts stay readable next to the bar.
    expect(readout(view)).toContain('CNY 80.00 / 100.00')
  })

  it('measures against the configured full-HP value from settings', async () => {
    state.healthBarMaxCny = 40
    const view = await mountWidget()

    await waitFor(() => { expect(readout(view)).toContain('CNY 80.00 / 40.00') })
    expect(fillWidth(view)).toBe('100%')
    expect(bar(view)?.getAttribute('aria-valuemax')).toBe('40')
  })

  it('caps the fill at full when the balance exceeds the ceiling without hiding the real amount', async () => {
    state.balance = 250
    const view = await mountWidget()

    await waitFor(() => { expect(fillWidth(view)).toBe('100%') })
    expect(bar(view)?.getAttribute('aria-valuenow')).toBe('100')
    expect(readout(view)).toContain('CNY 250.00 / 100.00')
  })

  it('turns critical and pulses once the balance falls into the last fifth', async () => {
    state.balance = 12
    const view = await mountWidget()

    await waitFor(() => { expect(fillWidth(view)).toBe('12%') })
    const element = bar(view)
    expect(element?.getAttribute('data-health-state')).toBe('critical')
    expect(element?.style.animation).toContain('tkm-health-critical')
    expect(element?.getAttribute('data-health-ratio')).toBe('0.1200')
  })

  it('empties the bar when the balance is exhausted', async () => {
    state.balance = 0
    const view = await mountWidget()

    await waitFor(() => { expect(fillWidth(view)).toBe('0%') })
    expect(bar(view)?.getAttribute('data-health-state')).toBe('empty')
    expect(bar(view)?.style.animation).toBe('')
  })

  it('renders the guidance text and no bar at all when the balance is unavailable', async () => {
    state.balanceOk = false
    const view = await mountWidget()

    await waitFor(() => { expect(readout(view)).toContain('未配置 API Key 或查询失败') })
    // An empty bar would read as "zero balance", which is a different claim.
    expect(bar(view)).toBeNull()
  })

  it('drains the fill as charge events arrive', async () => {
    const charges: Charge[] = []
    const view = await mountWithCharges(charges)

    // First poll seeds the charge cursor; the second one carries the new debit.
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000) })
    expect(fillWidth(view)).toBe('80%')
    charges.push({ id: 'charge-1', seq: 1, cost: 10, kind: 'output' })
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000) })

    expect(fillWidth(view)).toBe('70%')
    expect(readout(view)).toContain('CNY 70.00')
  })

  it('keeps a single red fill instead of recoloring it by ratio', async () => {
    const backgrounds: string[] = []
    for (const balance of [95, 50, 12]) {
      state.balance = balance
      const view = await mountWidget()
      await waitFor(() => { expect(fillWidth(view)).not.toBe('0%') })
      backgrounds.push(fillBackground(view))
      cleanup()
    }

    // Three very different levels, one and the same fill: the bar is red, full stop.
    expect(new Set(backgrounds).size).toBe(1)
    expect(backgrounds[0]).toContain('rgb(224, 49, 39)')
    expect(backgrounds[0]).toContain('linear-gradient')
  })

  it('lays a delayed trail behind the fill so drained balance stays lit', async () => {
    const view = await mountWidget()
    await waitFor(() => { expect(fillWidth(view)).toBe('80%') })

    const trail = view.baseElement.querySelector<HTMLElement>('[data-health-trail]')
    expect(trail).not.toBeNull()
    expect(trail?.style.width).toBe('80%')
    // The lag is the whole mechanism: same width, later transition, so the spent
    // segment stays bright and is then caught up by the fill.
    const style = trail?.getAttribute('style') ?? ''
    expect(style).toContain('transition')
    expect(style).toContain('220ms')
    // The trail must paint under the fill, otherwise it would cover it.
    expect(trail?.compareDocumentPosition(fill(view) as Node)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
  })

  it('fires a shockwave and sparks at the damage edge for a charge', async () => {
    const charges: Charge[] = []
    const view = await mountWithCharges(charges)

    await act(async () => { await vi.advanceTimersByTimeAsync(1_000) })
    // Nothing has been charged yet: no burst layer at all.
    expect(burst(view)).toBeNull()

    charges.push({ id: 'charge-1', seq: 1, cost: 10, kind: 'miss' })
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000) })

    const layer = burst(view)
    expect(layer?.getAttribute('data-health-burst')).toBe('red')
    expect(burstMagnitude(view)).toBeGreaterThan(0)
    expect(layer?.style.left).toBe('70%')
    // One shockwave ring plus the sparks, each carrying its own direction.
    const parts = Array.from(layer?.querySelectorAll('span') ?? [])
    expect(parts.length).toBeGreaterThanOrEqual(5)
    expect(parts[0]?.getAttribute('style')).toContain('tkm-health-shock')
    expect(parts[1]?.getAttribute('style')).toContain('--tkm-spark-x')
    expect(parts[1]?.getAttribute('style')).toContain('tkm-health-spark')
  })

  it('scales the burst, the sparks and the shake with how much a charge costs', async () => {
    const tiny = await mountWithCharge({ cost: 0.001, kind: 'hit' })
    const tinyMagnitude = burstMagnitude(tiny.view)
    const tinySparks = burstSparkCount(tiny.view)
    const tinyShake = tiny.shakeAmplitude

    cleanup()
    shakeCalls.length = 0

    const huge = await mountWithCharge({ cost: 5, kind: 'hit' })
    expect(burstMagnitude(huge.view)).toBeGreaterThan(tinyMagnitude)
    expect(burstSparkCount(huge.view)).toBeGreaterThan(tinySparks)
    expect(huge.shakeAmplitude).toBeGreaterThan(tinyShake)
  })

  it('ranks a cache miss above an ordinary hit of the same cost', async () => {
    const hit = await mountWithCharge({ cost: 0.02, kind: 'hit' })
    // 必须趁清理前读出来：卡片 portal 到 body，所有 view.baseElement 都是同一个
    // document.body，清理后再读会读到下一次挂载的 DOM，比较就失去意义了。
    const hitMagnitude = burstMagnitude(hit.view)

    cleanup()
    shakeCalls.length = 0

    const miss = await mountWithCharge({ cost: 0.02, kind: 'miss' })
    expect(burstMagnitude(miss.view)).toBeGreaterThan(hitMagnitude)
    expect(miss.shakeAmplitude).toBeGreaterThan(hit.shakeAmplitude)
  })

  it('flashes the whole bar on impact and clears it once the hit settles', async () => {
    const charges: Charge[] = []
    const view = await mountWithCharges(charges)

    await act(async () => { await vi.advanceTimersByTimeAsync(1_000) })
    const flashLayer = () => view.baseElement.querySelector<HTMLElement>('[data-health-screen-flash]')
    expect(flashLayer()?.style.opacity).toBe('0')

    charges.push({ id: 'charge-1', seq: 1, cost: 10, kind: 'output' })
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000) })
    expect(flashLayer()?.getAttribute('data-health-screen-flash')).toBe('red')
    expect(Number(flashLayer()?.style.opacity)).toBeGreaterThan(0)

    // The burst outlives the flash timer, then cleans itself up.
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000) })
    expect(flashLayer()?.style.opacity).toBe('0')
    expect(burst(view)).toBeNull()
  })

  it('scales the whole effect by the configured level', async () => {
    state.damageEffectLevel = 'strong'
    const strong = await mountWithCharge({ cost: 0.02, kind: 'hit' })
    const strongMagnitude = burstMagnitude(strong.view)

    cleanup()
    shakeCalls.length = 0

    state.damageEffectLevel = 'subtle'
    const subtle = await mountWithCharge({ cost: 0.02, kind: 'hit' })

    // Same charge, same bar — only the user's level differs.
    expect(burstMagnitude(subtle.view)).toBeLessThan(strongMagnitude)
    expect(subtle.shakeAmplitude).toBeLessThan(strong.shakeAmplitude)
  })

  it('draws no hit effect at all on the off level, while keeping the readout', async () => {
    state.damageEffectLevel = 'off'
    const { view } = await mountWithCharge({ cost: 0.02, kind: 'miss' })

    // 特效全关：不画受击层，也不抖动。
    expect(burst(view)).toBeNull()
    expect(shakeCalls).toHaveLength(0)
    expect(view.baseElement.querySelector<HTMLElement>('[data-health-screen-flash]')?.style.opacity).toBe('0')
    // 但「扣了多少」是信息而不是特效，必须照旧：血条扣了，飘字也在。
    expect(fillWidth(view)).toBe('79.98%')
    expect(readout(view)).toContain('CNY 79.98')
    expect(view.baseElement.querySelector('[data-charge-event-id]')).not.toBeNull()
  })
})
