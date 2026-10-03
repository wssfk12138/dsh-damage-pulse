// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ComponentProps } from 'react'
import type { ModuleSnapshot } from '../../../util/token-monitor-contract/src/index.ts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/client/settingsApi.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/client/settingsApi.ts')>()
  const contract = await import('../../../util/token-monitor-contract/src/index.ts')
  const fetcher = async (): Promise<Response> => new Response(JSON.stringify({
    schemaVersion: contract.TOKEN_MONITOR_SETTINGS_SCHEMA_VERSION,
    revision: 1,
    settings: { ...contract.DEFAULT_TOKEN_MONITOR_SETTINGS },
  }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  return { ...actual, createTokenMonitorSettingsApi: () => actual.createTokenMonitorSettingsApi(fetcher) }
})

const { BalanceWidget } = await import('../src/client/BalanceWidget.tsx')
const labels = ['显示鲸鱼娘', '显示用量概览', '用量明细', '通知设置', '计费规则', '模块管理']
const translations: Record<string, string> = { title: '用量明细', usage: '用量明细', notificationSettings: '通知设置', modulesTitle: '模块管理', billingTitle: '计费规则' }

beforeEach(() => { window.localStorage.clear() })
afterEach(() => { cleanup(); vi.restoreAllMocks() })

async function openMenu(balanceAvailable = true) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    if (String(input).startsWith('/api/token-monitor/balance')) {
      return new Response(JSON.stringify(balanceAvailable ? {
        currency: 'CNY', totalBalance: 100, grantedBalance: 0, toppedUpBalance: 100, isAvailable: true, updatedAt: 1,
      } : null), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    return new Response('', { status: 503 })
  })
  const useSessions = (selector: (state: { current: string }) => unknown) => selector({ current: 'session-1' })
  const t = (key: string) => translations[key] ?? key
  const props = { useSessions, t, refreshModules: vi.fn().mockResolvedValue(undefined), loadRouteEligibility: vi.fn().mockResolvedValue(true) } as unknown as ComponentProps<typeof BalanceWidget>
  const view = render(<BalanceWidget {...props} />)
  await waitFor(() => { expect(view.baseElement.querySelector('[data-token-monitor-balance]')).not.toBeNull() })
  const card = view.baseElement.querySelector('[data-token-monitor-balance]') as HTMLElement
  // Wait for the balance response, rather than mistaking the loading state for a disabled item.
  if (balanceAvailable) await waitFor(() => { expect(card.textContent).toContain('100') })
  fireEvent.contextMenu(card)
  const menu = screen.getByRole('menu', { name: '余额显示设置' })
  return { card, menu, item: (name: string) => within(menu).getByRole(name === labels[0] || name === labels[1] ? 'menuitemcheckbox' : 'menuitem', { name }) as HTMLButtonElement }
}

describe('BalanceWidget context menu (issue #28)', () => {
  it('opens the management-only gear without starting a card drag or changing preferences', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 503 }))
    const snapshot: ModuleSnapshot = {
      schemaVersion: 1, revision: 4, version: '4.2.3', pluginRemoved: false, restartRequired: false,
      modules: ['pet', 'overview', 'notify', 'billing', 'wechat'].map(id => ({
        id, status: id === 'wechat' ? 'installed' : 'removed', autoInstallBlocked: id !== 'wechat',
      })),
    }
    const gearTranslations: Record<string, string> = { modulesAnchor: '插件管理', modulesTitle: '卸载与更新', modulesClose: '关闭', modulesRestore: '恢复' }
    localStorage.setItem('dsh-token-monitor-balance-pos', JSON.stringify({ left: 100, top: 100 }))
    const props: ComponentProps<typeof BalanceWidget> = {
      useSessions: selector => selector({ ids: [], byId: {}, phase: 'ready', projectionsBySession: {} }),
      usePanelInfo: selector => selector({ activePanelId: null }),
      useSessionStatus: selector => selector(new Map()),
      useSessionRetainInfo: () => { throw new Error('unused retain hook') },
      useWorkspaces: () => { throw new Error('unused workspace hook') },
      useResource: () => { throw new Error('unused resource hook') },
      useModules: selector => selector(snapshot),
      refreshModules: vi.fn().mockResolvedValue(undefined),
      loadDisplayScope: async () => ({ provider: 'deepseek-official', model: 'deepseek-v4-flash' }),
      t: key => gearTranslations[key] ?? key,
    }
    const view = render(<BalanceWidget {...props} />)
    const card = view.baseElement.querySelector('[data-token-monitor-balance]') as HTMLElement
    const capture = vi.fn()
    Object.assign(card, { setPointerCapture: capture, hasPointerCapture: () => false })
    const gear = screen.getByRole('button', { name: '插件管理' })
    const before = { ...localStorage }
    // MouseEvent supplies button/coordinates even when jsdom has no PointerEvent constructor.
    fireEvent(gear, Object.assign(new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 20, clientY: 20 }), { pointerId: 1 }))
    expect(capture).not.toHaveBeenCalled()
    fireEvent(gear, Object.assign(new MouseEvent('pointerup', { bubbles: true, button: 0 }), { pointerId: 1 }))
    fireEvent.click(gear)
    const panel = await screen.findByRole('dialog', { name: '卸载与更新' })
    expect(within(panel).getAllByRole('button', { name: /^恢复 / })).toHaveLength(4)
    fireEvent.click(within(panel).getByRole('button', { name: '关闭' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect({ ...localStorage }).toEqual(before)

    const initialPosition = { left: Number.parseFloat(card!.style.left), top: Number.parseFloat(card!.style.top) }
    fireEvent(card!, Object.assign(new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 20, clientY: 20 }), { pointerId: 2 }))
    expect(capture).toHaveBeenCalledTimes(1)
    expect(capture).toHaveBeenCalledWith(2)
    fireEvent(card!, Object.assign(new MouseEvent('pointermove', { bubbles: true, button: 0, clientX: 50, clientY: 60 }), { pointerId: 2 }))
    const expectedPosition = { left: initialPosition.left + 30, top: initialPosition.top + 40 }
    expect(card!.style.left).toBe(expectedPosition.left + 'px')
    expect(card!.style.top).toBe(expectedPosition.top + 'px')
    fireEvent(card!, Object.assign(new MouseEvent('pointerup', { bubbles: true, button: 0, clientX: 50, clientY: 60 }), { pointerId: 2 }))
    expect(localStorage.getItem('dsh-token-monitor-balance-pos')).toBe(JSON.stringify(expectedPosition))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it.each(labels.slice(2))('opens only the %s panel and closes the menu', async (label) => {
    const { item } = await openMenu()
    fireEvent.click(item(label))
    expect(screen.queryByRole('menu')).toBeNull()
    if (label === '模块管理') {
      expect(await screen.findByRole('heading', { name: label })).toBeTruthy()
      expect(screen.getByRole('dialog', { name: label })).toBeTruthy()
      expect(screen.getAllByRole('dialog')).toHaveLength(1)
    } else {
      const dialog = await screen.findByRole('dialog', { name: new RegExp(label) })
      expect(screen.getAllByRole('dialog')).toHaveLength(1)
      expect(dialog).toBeTruthy()
      expect(screen.queryByRole('heading', { name: '模块管理' })).toBeNull()
    }
    // Opening a panel must not trigger notifications, edits, or external billing.
    const calls = vi.mocked(fetch).mock.calls
    expect(calls.every(([input, init]) => String(input).startsWith('/api/token-monitor/') && (!init?.method || init.method === 'GET'))).toBe(true)
  })

  it.each([
    ['显示鲸鱼娘', 'dsh-token-monitor-show-whale-girl', '[data-token-monitor-whale-layer]'],
    ['显示用量概览', 'dsh-token-monitor-show-usage-overview', '[data-token-monitor-token-layout]'],
  ])('toggles %s and restores its visible state and stored preference', async (label, key, selector) => {
    const { card, item } = await openMenu()
    const initial = item(label).getAttribute('aria-checked') === 'true'
    expect(Boolean(card.querySelector(selector))).toBe(initial)
    for (const expected of [!initial, initial]) {
      fireEvent.click(screen.getByRole('menuitemcheckbox', { name: label }))
      expect(screen.queryByRole('menu')).toBeNull()
      expect(window.localStorage.getItem(key)).toBe(JSON.stringify(expected))
      expect(Boolean(card.querySelector(selector))).toBe(expected)
      expect(card.querySelectorAll('canvas').length).toBeLessThanOrEqual(1)
      fireEvent.contextMenu(card)
      expect(screen.getByRole('menuitemcheckbox', { name: label }).getAttribute('aria-checked')).toBe(String(expected))
    }
  })

  it.each(['ContextMenu', 'F10'])('keeps keyboard opening and the existing card focus for %s', async (key) => {
    const { card } = await openMenu()
    fireEvent.keyDown(card, { key: 'Escape' })
    card.focus()
    expect(document.activeElement).toBe(card)
    fireEvent.keyDown(card, { key, shiftKey: key === 'F10' })
    const menu = screen.getByRole('menu')
    expect(document.activeElement).toBe(card)
    const action = within(menu).getByRole('menuitem', { name: '用量明细' })
    action.focus()
    expect(document.activeElement).toBe(action)
    fireEvent.keyDown(action, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('closes on outside pointerdown and window blur', async () => {
    const { card } = await openMenu()
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('menu')).toBeNull()
    fireEvent.contextMenu(card)
    fireEvent.blur(window)
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('blocks the balance-card tooltip for the whole menu without removing the card tooltip', async () => {
    const { card, menu, item } = await openMenu()
    expect(card.title).toContain('账户余额')
    expect(menu.getAttribute('title')).toBe('')
    // An explicit empty title stops native HTML title inheritance, including over child labels.
    for (const label of labels) expect(item(label).lastElementChild?.closest('[title]')).toBe(menu)
  })

  it.each(labels)('highlights %s on hover and clears the highlight on leave', async (label) => {
    const button = (await openMenu()).item(label)
    expect(button.disabled).toBe(false)
    expect(button.style.background).toBe('transparent')
    fireEvent.mouseEnter(button)
    expect(button.style.background).toBe('rgba(255, 255, 255, 0.1)')
    fireEvent.mouseLeave(button)
    expect(button.style.background).toBe('transparent')
  })

  it('keeps display switches distinct from action items and closes on Escape', async () => {
    const { menu, item } = await openMenu()
    expect(within(menu).getAllByRole('menuitemcheckbox')).toHaveLength(2)
    expect(within(menu).getAllByRole('menuitem')).toHaveLength(4)
    for (const label of labels.slice(2)) expect(item(label).hasAttribute('aria-checked')).toBe(false)
    fireEvent.keyDown(menu, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('does not highlight or activate the unavailable overview switch', async () => {
    const { item } = await openMenu(false)
    const button = item('显示用量概览')
    expect(button.disabled).toBe(true)
    const checked = button.getAttribute('aria-checked')
    fireEvent.mouseEnter(button)
    expect(button.style.background).toBe('transparent')
    fireEvent.click(button)
    expect(button.getAttribute('aria-checked')).toBe(checked)
    expect(window.localStorage.getItem('dsh-token-monitor-show-usage-overview')).toBeNull()
  })
})
