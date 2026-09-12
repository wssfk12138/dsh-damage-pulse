// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Minimal stateful Host settings double. It only changes when a PATCH arrives,
 * which is exactly the property under test: a localStorage-only write is
 * invisible to the Host and therefore cannot survive the authoritative refresh.
 */
const host = vi.hoisted(() => {
  const state = {
    showWhaleGirl: true,
    revision: 0,
    patches: [] as { expectedRevision?: number; patch: Record<string, unknown> }[],
  }
  return {
    state,
    reset(): void {
      state.showWhaleGirl = true
      state.revision = 0
      state.patches.length = 0
    },
    apply(patch: Record<string, unknown>): void {
      if (typeof patch.showWhaleGirl === 'boolean') state.showWhaleGirl = patch.showWhaleGirl
      state.revision += 1
    },
  }
})

// BalanceWidget builds its settings client as a module-level singleton, which
// captures `fetch` when the module is first imported. A per-test spy on
// globalThis.fetch therefore cannot reach it, so the factory is replaced here.
vi.mock('../src/client/settingsApi.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/client/settingsApi.ts')>()
  const contract = await import('../../../util/token-monitor-contract/src/index.ts')
  const fetcher = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (String(input) !== '/api/token-monitor/settings') return new Response('', { status: 404 })
    if (init?.method === 'PATCH') {
      const body = JSON.parse(String(init.body)) as { expectedRevision?: number; patch: Record<string, unknown> }
      host.state.patches.push(body)
      host.apply(body.patch)
    }
    return new Response(JSON.stringify({
      schemaVersion: contract.TOKEN_MONITOR_SETTINGS_SCHEMA_VERSION,
      revision: host.state.revision,
      settings: { ...contract.DEFAULT_TOKEN_MONITOR_SETTINGS, showWhaleGirl: host.state.showWhaleGirl },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
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
  host.reset()
  window.localStorage.clear()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function mountWidget() {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    if (String(input).startsWith('/api/token-monitor/balance')) {
      return new Response(JSON.stringify(BALANCE), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    return new Response('', { status: 503 })
  })
  const useSessions = (selector: (state: { current: string }) => unknown) => selector({ current: 'session-1' })
  const loadRouteEligibility = vi.fn().mockResolvedValue(true)
  const props = { useSessions, loadRouteEligibility } as unknown as ComponentProps<typeof BalanceWidget>
  return render(<BalanceWidget {...props} />)
}

async function openContextMenu(view: ReturnType<typeof render>) {
  await waitFor(() => { expect(view.container.querySelector('[data-token-monitor-balance]')).not.toBeNull() })
  const card = view.container.querySelector('[data-token-monitor-balance]')
  await act(async () => { fireEvent.contextMenu(card as Element) })
  return screen.getByRole('menuitemcheckbox', { name: /显示鲸鱼娘/ })
}

function isChecked(toggle: HTMLElement): boolean {
  return toggle.getAttribute('aria-checked') === 'true'
}

describe('BalanceWidget whale-girl toggle', () => {
  it('writes the toggle through to the Host settings endpoint', async () => {
    const view = mountWidget()
    const toggle = await openContextMenu(view)
    expect(isChecked(toggle)).toBe(true)

    await act(async () => { fireEvent.click(toggle) })

    await waitFor(() => {
      expect(host.state.patches.map(entry => entry.patch)).toEqual([{ showWhaleGirl: false }])
    })
  })

  it('keeps the toggle unchecked across an authoritative settings refresh', async () => {
    const view = mountWidget()
    const toggle = await openContextMenu(view)

    await act(async () => { fireEvent.click(toggle) })

    // The widget re-reads settings on window focus; the Host must already agree,
    // otherwise this refresh silently restores the box to checked.
    await act(async () => { window.dispatchEvent(new Event('focus')) })

    const reopened = await openContextMenu(view)
    expect(isChecked(reopened)).toBe(false)
  })
})
