// @vitest-environment jsdom

import { cleanup, render, waitFor } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/** The current inner-test baseline keeps the card in shell.overlay. */

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
  it('keeps the card inside the shell overlay contribution', async () => {
    const view = await mountWidget()

    expect(view.container.contains(card(view))).toBe(true)
    expect(view.container.childElementCount).toBe(1)
  })

  it('uses the dedicated overlay stacking level', async () => {
    const z = Number(card(await mountWidget()).style.zIndex)

    expect(z).toBe(1000)
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
