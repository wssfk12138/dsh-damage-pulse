// @vitest-environment jsdom

import { cleanup, render, waitFor } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The card is registered in the frame shell.overlay seat, but that seat's layer
 * (.overlayLayer) is a stacking context at z-index 20, so a card left inside it
 * can never paint above the right sidebar's floating panel, which the host
 * portals to document.body at z-index 60. These tests pin the escape hatch: the
 * card is portalled onto document.body itself and states a stacking level that
 * beats the floating panels while staying under host menus.
 */

// Host buckets this card sits between: the shell overlay layer (20) and the
// floating sidebar panels (.floatHost, 60) below, the dockkit tab menu (70) and
// every host overlay, menu and modal (>= 100) above.
const OVERLAY_LAYER_Z = 20
const SIDEBAR_FLOAT_Z = 60
const HOST_MENU_Z = 70

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

beforeEach(() => {
  window.localStorage.clear()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function card(view: ReturnType<typeof render>): HTMLElement {
  return view.baseElement.querySelector('[data-token-monitor-balance]') as HTMLElement
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

describe('BalanceWidget layer escape', () => {
  it('portals the card out of the frame overlay layer and onto the shared body', async () => {
    const view = await mountWidget()

    expect(card(view).parentElement).toBe(document.body)
    expect(view.container.childElementCount).toBe(0)
  })

  it('states a stacking level above the sidebar floating panels and below host menus', async () => {
    const z = Number(card(await mountWidget()).style.zIndex)

    expect(z).toBeGreaterThan(OVERLAY_LAYER_Z)
    expect(z).toBeGreaterThan(SIDEBAR_FLOAT_Z)
    expect(z).toBeLessThan(HOST_MENU_Z)
  })

  it('keeps its own pointer-events and the whale layer anchored inside the card', async () => {
    const element = card(await mountWidget())

    // The .overlayLayer > * rule used to grant pointer events; outside that
    // layer the card must declare them itself.
    expect(element.style.pointerEvents).toBe('auto')
    // Only the card root moves: the whale keeps its in-card anchoring, so the
    // size and drag contracts are untouched.
    expect(element.querySelector('[data-token-monitor-whale-layer]')).not.toBeNull()
  })
})
