// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The widget position is user intent, not a layout measurement. Shrinking or
 * minimising the window collapses `innerWidth` / `innerHeight` (WebView2 reports
 * a zero-height viewport while minimised), and a clamp persisted from that
 * transient viewport destroys the position the user chose. These tests pin the
 * invariant: layout changes never overwrite intent after the one-time legacy migration.
 */

const POS_KEY = 'dsh-token-monitor-balance-pos'

vi.mock('../src/client/settingsApi.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/client/settingsApi.ts')>()
  const contract = await import('../../../util/token-monitor-contract/src/index.ts')
  const fetcher = async (): Promise<Response> => new Response(JSON.stringify({
    schemaVersion: contract.TOKEN_MONITOR_SETTINGS_SCHEMA_VERSION,
    revision: 1,
    settings: { ...contract.DEFAULT_TOKEN_MONITOR_SETTINGS },
  }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  return {
    ...actual,
    createTokenMonitorSettingsApi: () => actual.createTokenMonitorSettingsApi(fetcher),
  }
})

const { BalanceWidget } = await import('../src/client/BalanceWidget.tsx')

const BALANCE = {
  currency: 'CNY',
  totalBalance: 100,
  grantedBalance: 0,
  toppedUpBalance: 100,
  isAvailable: true,
  updatedAt: 1,
}

/** Position the user dragged the card to before the window changed size. */
const USER_POS = { left: 305, top: 492 }
let measuredWidth = 180
let measuredHeight = 34
const resizeCallbacks = new Set<ResizeObserverCallback>()

function setViewport(width: number, height: number): void {
  Object.defineProperty(window, 'innerWidth', { value: width, configurable: true, writable: true })
  Object.defineProperty(window, 'innerHeight', { value: height, configurable: true, writable: true })
}

function storedPos(): { left: number; top: number } | null {
  const raw = window.localStorage.getItem(POS_KEY)
  if (raw === null) return null
  const saved = JSON.parse(raw) as { mode?: string; left: number; top: number }
  const minTop = Number.parseFloat(document.documentElement.style.getPropertyValue('--dsh-frame-top-clearance')) || 0
  return saved.mode === 'relative'
    ? { left: saved.left * (1024 - 180), top: minTop + saved.top * (768 - 34 - minTop) } : saved
}

/** The card is portalled onto document.body, so queries walk the base element. */
function card(view: ReturnType<typeof render>): HTMLElement {
  return view.baseElement.querySelector('[data-token-monitor-balance]') as HTMLElement
}

function renderedPos(view: ReturnType<typeof render>): { left: number; top: number } {
  const { style } = card(view)
  return { left: Number.parseFloat(style.left), top: Number.parseFloat(style.top) }
}

function fireResize(): void {
  act(() => { window.dispatchEvent(new Event('resize')) })
}

/** jsdom does not implement pointer capture; the drag path only needs it to exist. */
function stubPointerCapture(element: HTMLElement): void {
  Object.assign(element, {
    setPointerCapture: () => undefined,
    releasePointerCapture: () => undefined,
    hasPointerCapture: () => false,
  })
}

async function mountWidget(): Promise<ReturnType<typeof render>> {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    if (String(input).startsWith('/api/token-monitor/balance')) {
      return new Response(JSON.stringify(BALANCE), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    return new Response('', { status: 503 })
  })
  const useSessions = (selector: (state: { current: string }) => unknown) => selector({ current: 'session-1' })
  const loadRouteEligibility = vi.fn().mockResolvedValue(true)
  const props = { useSessions, loadRouteEligibility } as unknown as ComponentProps<typeof BalanceWidget>
  const view = render(<BalanceWidget {...props} />)
  await waitFor(() => { expect(view.baseElement.querySelector('[data-token-monitor-balance]')).not.toBeNull() })
  return view
}

beforeEach(() => {
  measuredWidth = 180
  measuredHeight = 34
  resizeCallbacks.clear()
  vi.stubGlobal('ResizeObserver', class {
    constructor(private callback: ResizeObserverCallback) {}
    observe() { resizeCallbacks.add(this.callback) }
    disconnect() { resizeCallbacks.delete(this.callback) }
  })
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({ width: measuredWidth, height: measuredHeight } as DOMRect))
  window.localStorage.clear()
  window.localStorage.setItem(POS_KEY, JSON.stringify(USER_POS))
  setViewport(1024, 768)
})

afterEach(() => {
  cleanup()
  document.documentElement.style.removeProperty('--dsh-frame-top-clearance')
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  setViewport(1024, 768)
})

describe('BalanceWidget stored position', () => {
  it('migrates a legacy position as soon as the deferred card mounts', async () => {
    const view = await mountWidget()
    const saved = JSON.parse(localStorage.getItem(POS_KEY)!) as { mode: string }
    expect(saved.mode).toBe('relative')
    expect(renderedPos(view)).toEqual(USER_POS)
    expect(resizeCallbacks.size).toBe(2)
    view.unmount()
    expect(resizeCallbacks.size).toBe(0)
  })

  it('preserves proportions across viewport changes, remounts and card size changes', async () => {
    const view = await mountWidget()
    const saved = localStorage.getItem(POS_KEY)
    setViewport(700, 500)
    fireResize()
    expect(renderedPos(view).left).toBeCloseTo(USER_POS.left * 520 / 844)
    expect(renderedPos(view).top).toBeCloseTo(USER_POS.top * 466 / 734)
    measuredWidth = 300
    measuredHeight = 60
    act(() => { for (const callback of resizeCallbacks) callback([], {} as ResizeObserver) })
    expect(renderedPos(view).left).toBeCloseTo(USER_POS.left * 400 / 844)
    expect(renderedPos(view).top).toBeCloseTo(USER_POS.top * 440 / 734)
    expect(localStorage.getItem(POS_KEY)).toBe(saved)
    view.unmount()
    const remounted = await mountWidget()
    expect(renderedPos(remounted).left).toBeCloseTo(USER_POS.left * 400 / 844)
    expect(renderedPos(remounted).top).toBeCloseTo(USER_POS.top * 440 / 734)
  })

  it('restores automatic corner anchoring immediately and after remount', async () => {
    const view = await mountWidget()
    fireEvent.contextMenu(card(view), { clientX: 310, clientY: 490 })
    fireEvent.click(view.getByRole('menuitem', { name: 'restoreDefaultPosition' }))
    expect(localStorage.getItem(POS_KEY)).toBeNull()
    expect(renderedPos(view)).toEqual({ left: 828, top: 718 })
    setViewport(700, 500)
    fireResize()
    expect(renderedPos(view)).toEqual({ left: 504, top: 450 })
    view.unmount()
    const remounted = await mountWidget()
    expect(renderedPos(remounted)).toEqual({ left: 504, top: 450 })
    expect(localStorage.getItem(POS_KEY)).toBeNull()
  })

  it('keeps automatic anchoring on clicks and movement below the drag threshold', async () => {
    localStorage.removeItem(POS_KEY)
    const view = await mountWidget()
    const element = card(view)
    stubPointerCapture(element)
    fireEvent.pointerDown(element, { button: 0, clientX: 100, clientY: 100, pointerId: 1 })
    fireEvent.pointerMove(element, { clientX: 102, clientY: 101, pointerId: 1 })
    fireEvent.pointerUp(element, { pointerId: 1 })
    expect(localStorage.getItem(POS_KEY)).toBeNull()
    setViewport(700, 500)
    fireResize()
    expect(renderedPos(view)).toEqual({ left: 504, top: 450 })
  })

  it.each(['null', '{', '{"left":1e999,"top":0}', '{"mode":"relative","left":1.1,"top":0}', '{"mode":"other","left":1,"top":0}'])(
    'defaults safely for malformed stored position %s', async (raw) => {
      localStorage.setItem(POS_KEY, raw)
      const view = await mountWidget()
      expect(renderedPos(view)).toEqual({ left: 828, top: 718 })
    },
  )

  it('defaults to the lower region and allows top zero when the host has no title strip', async () => {
    window.localStorage.removeItem(POS_KEY)
    const defaultView = await mountWidget()
    // jsdom has no layout measurements; supply the card's measured dimensions.
    vi.spyOn(card(defaultView), 'getBoundingClientRect').mockReturnValue({ width: 180, height: 34 } as DOMRect)
    fireResize()
    expect(renderedPos(defaultView).top).toBeGreaterThan(window.innerHeight / 2)
    defaultView.unmount()
    window.localStorage.setItem(POS_KEY, JSON.stringify({ left: 305, top: 0 }))
    const topView = await mountWidget()
    expect(renderedPos(topView).top).toBe(0)
  })
  it('keeps stored and dragged cards out of the desktop title strip, and permits dragging back down', async () => {
    document.documentElement.style.setProperty('--dsh-frame-top-clearance', '40px')
    window.localStorage.setItem(POS_KEY, JSON.stringify({ left: 305, top: 0 }))
    const view = await mountWidget()
    expect(renderedPos(view).top).toBe(40)
    const element = card(view)
    stubPointerCapture(element)
    fireEvent.pointerDown(element, { button: 0, clientX: 320, clientY: 50, pointerId: 1 })
    fireEvent.pointerMove(element, { clientX: 320, clientY: -200, pointerId: 1 })
    fireEvent.pointerUp(element, { clientX: 320, clientY: -200, pointerId: 1 })
    expect(renderedPos(view).top).toBe(40)
    expect(storedPos()?.top).toBe(40)
    fireEvent.pointerDown(element, { button: 0, clientX: 320, clientY: 50, pointerId: 2 })
    fireEvent.pointerMove(element, { clientX: 320, clientY: 450, pointerId: 2 })
    fireEvent.pointerUp(element, { clientX: 320, clientY: 450, pointerId: 2 })
    expect(renderedPos(view).top).toBe(440)
    expect(storedPos()?.top).toBe(440)
  })
  it('keeps the user position when the window height collapses', async () => {
    const view = await mountWidget()
    expect(renderedPos(view)).toEqual(USER_POS)

    // Minimising / shrinking the window: WebView2 reports a zero-height viewport.
    setViewport(1024, 0)
    fireResize()

    expect(storedPos()).toEqual(USER_POS)

    // Restoring the window must bring the card back to the position the user chose.
    setViewport(1024, 768)
    fireResize()

    expect(renderedPos(view)).toEqual(USER_POS)
  })

  it('keeps the user position when the whole viewport collapses to zero', async () => {
    const view = await mountWidget()

    setViewport(0, 0)
    fireResize()
    expect(storedPos()).toEqual(USER_POS)

    setViewport(1024, 768)
    fireResize()
    expect(renderedPos(view)).toEqual(USER_POS)
  })

  it('stores a dragged position and still restores it after a collapse', async () => {
    const view = await mountWidget()
    const element = card(view)
    stubPointerCapture(element)

    act(() => {
      fireEvent.pointerDown(element, { button: 0, clientX: 10, clientY: 10, pointerId: 1 })
      fireEvent.pointerMove(element, { clientX: 30, clientY: 40, pointerId: 1 })
      fireEvent.pointerUp(element, { clientX: 30, clientY: 40, pointerId: 1 })
    })

    const dragged = { left: USER_POS.left + 20, top: USER_POS.top + 30 }
    expect(storedPos()).toEqual(dragged)

    setViewport(1024, 0)
    fireResize()
    setViewport(1024, 768)
    fireResize()

    expect(storedPos()).toEqual(dragged)
    expect(renderedPos(view)).toEqual(dragged)
  })

  it('clamps a card that no longer fits into the shrunk viewport without persisting the clamp', async () => {
    const view = await mountWidget()

    setViewport(200, 120)
    fireResize()

    const clamped = renderedPos(view)
    expect(clamped.left).toBeLessThanOrEqual(200)
    expect(clamped.top).toBeLessThanOrEqual(120)
    expect(storedPos()).toEqual(USER_POS)

    setViewport(1024, 768)
    fireResize()
    expect(renderedPos(view)).toEqual(USER_POS)
  })
})
