// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { DEFAULT_TOKEN_MONITOR_SETTINGS, TOKEN_MONITOR_SETTINGS_SCHEMA_VERSION } from '@deepseek-ai/dsh-token-monitor-contract'
import { BalanceWidget } from '../src/client/BalanceWidget.tsx'
import type { ComponentProps } from 'react'

vi.mock('../src/client/WhaleGirlStage.tsx', () => ({ WhaleGirlStage: () => <div data-testid="whale-animation" /> }))
vi.mock('../src/client/settingsApi.ts', async importOriginal => ({
  ...await importOriginal<typeof import('../src/client/settingsApi.ts')>(),
  createTokenMonitorSettingsApi: () => ({
    get: async () => ({
      schemaVersion: TOKEN_MONITOR_SETTINGS_SCHEMA_VERSION,
      revision: 1,
      settings: { ...DEFAULT_TOKEN_MONITOR_SETTINGS, showWhaleGirl: true },
    }),
  }),
}))

afterEach(() => { cleanup(); localStorage.clear(); vi.useRealTimers(); vi.unstubAllGlobals() })

it('keeps an explicit hide across settings refresh, balance changes, route changes and remount until explicitly shown', async () => {
  vi.useFakeTimers()
  let balance: number | null = 10
  let provider = 'deepseek-official'
  const loadDisplayScope = async () => ({ provider, model: 'test' })
  vi.stubGlobal('fetch', vi.fn(async (input: string) => {
    let body: unknown = null
    if (input.includes('/settings')) body = { schemaVersion: TOKEN_MONITOR_SETTINGS_SCHEMA_VERSION, revision: 1, settings: { ...DEFAULT_TOKEN_MONITOR_SETTINGS, showWhaleGirl: true } }
    if (input.includes('/balance?')) body = balance === null ? null : { totalBalance: balance, currency: 'CNY' }
    if (input.includes('/charge-events')) body = { events: [], seq: 0, streamId: 'test' }
    return new Response(JSON.stringify(body))
  }))
  const mount = () => {
    const props = {
      useSessions: (select: (state: unknown) => unknown) => select({ byId: {} }),
      loadDisplayScope,
      t: (key: string) => key,
    } as unknown as ComponentProps<typeof BalanceWidget>
    return render(<BalanceWidget {...props} />)
  }
  const toggle = () => {
    fireEvent.contextMenu(document.querySelector('[data-token-monitor-balance]')!)
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: '显示鲸鱼娘' }))
  }
  const hidden = () => {
    expect(screen.queryByTestId('whale-animation')).toBeNull()
    expect(document.querySelector('[data-token-monitor-whale-depleted]')).toBeNull()
  }
  let view = mount()
  await act(async () => {})
  expect(screen.queryByTestId('whale-animation')).not.toBeNull()
  toggle()
  hidden()
  await act(async () => { window.dispatchEvent(new Event('focus')) })
  hidden()
  for (const next of [0, 20, null]) {
    balance = next
    await act(async () => { await vi.advanceTimersByTimeAsync(15000) })
    hidden()
  }
  provider = 'third-party'
  await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
  hidden()
  view.unmount()
  view = mount()
  hidden()
  await act(async () => {})
  hidden()
  toggle()
  expect(screen.queryByTestId('whale-animation')).not.toBeNull()
  view.unmount()
})
