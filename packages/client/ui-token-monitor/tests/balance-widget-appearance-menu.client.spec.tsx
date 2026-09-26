// @vitest-environment jsdom

/**
 * The card's right-click menu owns the bar's appearance: colour and hit-effect level.
 * Both are Host settings, not local state — the menu's checked control and the painted
 * bar must come back from the authoritative snapshot, otherwise a failed write would
 * leave the menu claiming a look the bar is not using.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const host = vi.hoisted(() => {
  const state = {
    healthBarColor: 'red',
    damageEffectLevel: 'normal',
    revision: 0,
    failPatches: 0,
    patches: [] as { expectedRevision?: number; patch: Record<string, unknown> }[],
  }
  return {
    state,
    reset(): void {
      state.healthBarColor = 'red'
      state.damageEffectLevel = 'normal'
      state.revision = 0
      state.failPatches = 0
      state.patches.length = 0
    },
    apply(patch: Record<string, unknown>): void {
      if (typeof patch.healthBarColor === 'string') state.healthBarColor = patch.healthBarColor
      if (typeof patch.damageEffectLevel === 'string') state.damageEffectLevel = patch.damageEffectLevel
      state.revision += 1
    },
  }
})

vi.mock('../src/client/settingsApi.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/client/settingsApi.ts')>()
  const contract = await import('../../../util/token-monitor-contract/src/index.ts')
  const fetcher = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (String(input) !== '/api/token-monitor/settings') return new Response('', { status: 404 })
    if (init?.method === 'PATCH') {
      const body = JSON.parse(String(init.body)) as { expectedRevision?: number; patch: Record<string, unknown> }
      host.state.patches.push(body)
      if (host.state.failPatches > 0) {
        host.state.failPatches -= 1
        return new Response(JSON.stringify({ code: 'UNAVAILABLE', message: 'settings store busy' }), { status: 503, headers: { 'Content-Type': 'application/json' } })
      }
      host.apply(body.patch)
    }
    return new Response(JSON.stringify({
      schemaVersion: contract.TOKEN_MONITOR_SETTINGS_SCHEMA_VERSION,
      revision: host.state.revision,
      settings: {
        ...contract.DEFAULT_TOKEN_MONITOR_SETTINGS,
        healthBarColor: host.state.healthBarColor,
        damageEffectLevel: host.state.damageEffectLevel,
      },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
  return {
    ...actual,
    createTokenMonitorSettingsApi: () => actual.createTokenMonitorSettingsApi(fetcher),
  }
})

const { BalanceWidget } = await import('../src/client/BalanceWidget.tsx')
const { HEALTH_BAR_PALETTES } = await import('../src/client/healthBarPalette.ts')
const { DAMAGE_EFFECT_LABELS } = await import('../src/client/damageScale.ts')

const BALANCE = {
  currency: 'CNY',
  totalBalance: 80,
  grantedBalance: 0,
  toppedUpBalance: 80,
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

function mountWidget(): ReturnType<typeof render> {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    if (String(input).startsWith('/api/token-monitor/balance')) {
      return new Response(JSON.stringify(BALANCE), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    return new Response('', { status: 503 })
  })
  const useSessions = (selector: (state: { current: string }) => unknown) => selector({ current: 'session-1' })
  const props = { useSessions, loadRouteEligibility: vi.fn().mockResolvedValue(true) } as unknown as ComponentProps<typeof BalanceWidget>
  return render(<BalanceWidget {...props} />)
}

async function openContextMenu(view: ReturnType<typeof render>): Promise<void> {
  await waitFor(() => { expect(view.baseElement.querySelector('[data-token-monitor-balance]')).not.toBeNull() })
  const card = view.baseElement.querySelector('[data-token-monitor-balance]')
  await act(async () => { fireEvent.contextMenu(card as Element) })
}

function barColor(view: ReturnType<typeof render>): string | null {
  return view.baseElement.querySelector('[data-token-monitor-health-bar]')?.getAttribute('data-health-color') ?? null
}

function fillBackground(view: ReturnType<typeof render>): string {
  return view.baseElement.querySelector<HTMLElement>('[data-health-fill]')?.style.background ?? ''
}

function swatch(view: ReturnType<typeof render>, color: string): HTMLElement {
  return view.baseElement.querySelector<HTMLElement>(`[data-health-color-option="${color}"]`) as HTMLElement
}

function levelButton(view: ReturnType<typeof render>, level: string): HTMLElement {
  return view.baseElement.querySelector<HTMLElement>(`[data-damage-effect-option="${level}"]`) as HTMLElement
}

function checked(element: HTMLElement): boolean {
  return element.getAttribute('aria-checked') === 'true'
}

describe('BalanceWidget health bar colour menu', () => {
  it('offers every palette preset in the menu with the active one checked', async () => {
    const view = mountWidget()
    await openContextMenu(view)

    const options = view.baseElement.querySelectorAll('[data-health-color-option]')
    expect(options).toHaveLength(HEALTH_BAR_PALETTES.length)
    expect(checked(swatch(view, 'red'))).toBe(true)
    expect(checked(swatch(view, 'violet'))).toBe(false)
    expect(swatch(view, 'violet').getAttribute('aria-label')).toBe('血条颜色：紫')
  })

  it('repaints the bar and writes the chosen colour through to the Host', async () => {
    const view = mountWidget()
    await openContextMenu(view)
    const before = fillBackground(view)

    await act(async () => { fireEvent.click(swatch(view, 'violet')) })

    await waitFor(() => { expect(host.state.patches.map(entry => entry.patch)).toEqual([{ healthBarColor: 'violet' }]) })
    await waitFor(() => { expect(barColor(view)).toBe('violet') })
    expect(fillBackground(view)).not.toBe(before)
    expect(checked(swatch(view, 'violet'))).toBe(true)
  })

  it('keeps the menu open so several colours can be compared', async () => {
    const view = mountWidget()
    await openContextMenu(view)

    await act(async () => { fireEvent.click(swatch(view, 'cyan')) })
    await waitFor(() => { expect(barColor(view)).toBe('cyan') })

    // Closing on the first click would force a reopen per comparison.
    expect(view.baseElement.querySelectorAll('[data-health-color-option]')).toHaveLength(HEALTH_BAR_PALETTES.length)
  })

  it('falls back to the Host colour and warns when the write fails', async () => {
    host.state.failPatches = 1
    const view = mountWidget()
    await openContextMenu(view)
    const before = fillBackground(view)

    await act(async () => { fireEvent.click(swatch(view, 'amber')) })

    await waitFor(() => {
      expect(view.baseElement.querySelector('[data-token-monitor-settings-notice]')).not.toBeNull()
    })
    // The bar still uses the Host value; the menu must therefore still mark it.
    expect(barColor(view)).toBe('red')
    expect(fillBackground(view)).toBe(before)
    expect(checked(swatch(view, 'amber'))).toBe(false)
  })
})

describe('BalanceWidget damage effect level menu', () => {
  it('offers every level with the active one checked', async () => {
    const view = mountWidget()
    await openContextMenu(view)

    const group = view.baseElement.querySelector('[role="radiogroup"][aria-label="扣血特效强度"]')
    expect(group).not.toBeNull()
    expect(view.baseElement.querySelectorAll('[data-damage-effect-option]')).toHaveLength(Object.keys(DAMAGE_EFFECT_LABELS).length)

    expect(checked(levelButton(view, 'normal'))).toBe(true)
    expect(checked(levelButton(view, 'off'))).toBe(false)
    expect(levelButton(view, 'extreme').getAttribute('aria-label')).toBe('扣血特效强度：极强')
  })

  it('writes the chosen level through to the Host and marks it', async () => {
    const view = mountWidget()
    await openContextMenu(view)

    await act(async () => { fireEvent.click(levelButton(view, 'extreme')) })

    await waitFor(() => { expect(host.state.patches.map(entry => entry.patch)).toEqual([{ damageEffectLevel: 'extreme' }]) })
    await waitFor(() => { expect(checked(levelButton(view, 'extreme'))).toBe(true) })
    expect(checked(levelButton(view, 'normal'))).toBe(false)
  })

  it('restores the Host level and warns when the write fails', async () => {
    host.state.failPatches = 1
    const view = mountWidget()
    await openContextMenu(view)

    await act(async () => { fireEvent.click(levelButton(view, 'off')) })

    await waitFor(() => {
      expect(view.baseElement.querySelector('[data-token-monitor-settings-notice]')).not.toBeNull()
    })
    expect(host.state.damageEffectLevel).toBe('normal')
    expect(checked(levelButton(view, 'normal'))).toBe(true)
    expect(checked(levelButton(view, 'off'))).toBe(false)
  })
})
