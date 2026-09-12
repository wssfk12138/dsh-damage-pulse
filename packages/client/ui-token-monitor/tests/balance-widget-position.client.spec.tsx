// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The widget position is user intent, not a layout measurement. Shrinking or
 * minimising the window collapses `innerWidth` / `innerHeight` (WebView2 reports
 * a zero-height viewport while minimised), and a clamp persisted from that
 * transient viewport destroys the position the user chose. These tests pin the
 * invariant: only a drag writes the stored position.
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

function setViewport(width: number, height: number): void {
  Object.defineProperty(window, 'innerWidth', { value: width, configurable: true, writable: true })
  Object.defineProperty(window, 'innerHeight', { value: height, configurable: true, writable: true })
}

function storedPos(): { left: number; top: number } | null {
  const raw = window.localStorage.getItem(POS_KEY)
  return raw === null ? null : JSON.parse(raw) as { left: number; top: number }
}

function card(view: ReturnType<typeof render>): HTMLElement {
  return view.container.querySelector('[data-token-monitor-balance]') as HTMLElement
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
  await waitFor(() => { expect(view.container.querySelector('[data-token-monitor-balance]')).not.toBeNull() })
  return view
}

beforeEach(() => {
  window.localStorage.clear()
  window.localStorage.setItem(POS_KEY, JSON.stringify(USER_POS))
  setViewport(1024, 768)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  setViewport(1024, 768)
})

describe('BalanceWidget stored position', () => {
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
