// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import {
  DEFAULT_TOKEN_MONITOR_SETTINGS,
  TOKEN_MONITOR_SETTINGS_SCHEMA_VERSION,
  type TokenMonitorSettings,
  type TokenMonitorSettingsPatchRequest,
  type TokenMonitorSettingsSnapshot,
} from '@deepseek-ai/dsh-token-monitor-contract'
import { TokenMonitorSettingsPanel } from '../src/client/TokenMonitorSettingsPanel.tsx'
import type { WechatConnectionApi, WechatRuntimeStatus } from '../src/client/wechatConnectionApi.ts'
import type { HostCompatApi, HostCompatStatus } from '../src/client/hostCompatApi.ts'

const wechatStatus: WechatRuntimeStatus = {
  schemaVersion: 1,
  provider: 'clawbot-wechat',
  availability: 'available',
  auth: 'authenticated',
  process: 'host-managed-running',
  delivery: 'ready',
  operation: 'idle',
  capabilities: { canLogin: true, canReconnect: true, canDisconnect: true },
  checkedAt: Date.parse('2026-09-14T02:00:00Z'),
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

interface MountOptions {
  settings?: Partial<TokenMonitorSettings>
  delayMs?: number
  failure?: string
  hostCompatApi?: HostCompatApi
}

it('shows the session-record notice when the host cannot keep the ignorable marker', async () => {
  const unsupported: HostCompatStatus = {
    schemaVersion: 1,
    sessionRecords: { capability: 'unsupported', hostVersion: '0.1.7-alpha.2', detail: 'test', forced: false },
  }
  const hostCompatApi = { status: vi.fn(async () => unsupported) } as unknown as HostCompatApi
  mount({ hostCompatApi })
  const hint = await screen.findByText(/不会把「可忽略」标记写进会话日志/u)
  expect(hint.getAttribute('data-host-compat-hint')).toBe('')
  expect(hostCompatApi.status).toHaveBeenCalledTimes(1)
})

it('stays silent when the host keeps the marker', async () => {
  const supported: HostCompatStatus = {
    schemaVersion: 1,
    sessionRecords: { capability: 'supported', hostVersion: '0.1.7-rc.2', detail: 'test', forced: false },
  }
  const hostCompatApi = { status: vi.fn(async () => supported) } as unknown as HostCompatApi
  mount({ hostCompatApi })
  await screen.findByText('提醒规则')
  await waitFor(() => { expect(hostCompatApi.status).toHaveBeenCalledTimes(1) })
  expect(screen.queryByText(/可忽略/u)).toBeNull()
})

it('starts settings with rules and removes the overview and its request', async () => {
  mount()
  await screen.findByText('提醒规则')
  expect(screen.queryByText('概览')).toBeNull()
  expect(screen.queryByText('数据概览')).toBeNull()
  expect(document.querySelector('.token-monitor-settings__grid')?.firstElementChild?.className).toBe('token-monitor-settings__left-stack')
  expect(vi.mocked(fetch).mock.calls.some(([url]) => typeof url === 'string' && url.includes('usage-summary'))).toBe(false)
})

/**
 * 模拟 Host 的 settings 端点：串行接受 patch、递增 revision，并记录同时在途的请求数。
 */
function mount(options: MountOptions = {}) {
  const defaults = { ...DEFAULT_TOKEN_MONITOR_SETTINGS, ...options.settings } as TokenMonitorSettings
  const state = {
    revision: 3,
    server: { ...defaults },
    inflight: 0,
    maxInflight: 0,
  }
  const onSave = vi.fn(async (request: TokenMonitorSettingsPatchRequest): Promise<TokenMonitorSettingsSnapshot> => {
    state.inflight += 1
    state.maxInflight = Math.max(state.maxInflight, state.inflight)
    try {
      if (options.delayMs !== undefined) await new Promise(resolve => setTimeout(resolve, options.delayMs))
      else await Promise.resolve()
      if (options.failure !== undefined) throw new Error(options.failure)
      state.revision += 1
      Object.assign(state.server, request.patch)
      return {
        schemaVersion: TOKEN_MONITOR_SETTINGS_SCHEMA_VERSION,
        revision: state.revision,
        settings: { ...state.server },
      }
    } finally {
      state.inflight -= 1
    }
  })
  const onClose = vi.fn()
  const wechatApi = {
    status: vi.fn(async () => wechatStatus),
    login: vi.fn(),
    confirmLogin: vi.fn(),
    reconnect: vi.fn(),
    disconnect: vi.fn(),
    testMessage: vi.fn(),
  } as unknown as WechatConnectionApi
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (url.includes('/api/token-monitor/usage-summary')) throw new Error('Settings must not fetch the usage overview')
    return { ok: true, json: async () => ({}) }
  }))
  const snapshotFor = (revision: number, overrides: Partial<TokenMonitorSettings> = {}): TokenMonitorSettingsSnapshot => ({
    schemaVersion: TOKEN_MONITOR_SETTINGS_SCHEMA_VERSION,
    revision,
    settings: { ...defaults, ...overrides },
  })
  const element = (snapshot: TokenMonitorSettingsSnapshot) => (
    <TokenMonitorSettingsPanel title="通知设置" snapshot={snapshot} onSave={onSave} onClose={onClose} wechatApi={wechatApi} hostCompatApi={options.hostCompatApi} />
  )
  const view = render(element(snapshotFor(state.revision)))
  return { onSave, onClose, state, view, snapshotFor, element }
}

function switchByName(name: string): HTMLElement {
  return screen.getByRole('switch', { name })
}

it('开关改动立即自动保存，页脚不再有保存或关闭按钮', async () => {
  const { onSave, state } = mount()
  expect(switchByName('微信通知').getAttribute('aria-checked')).toBe('true')

  fireEvent.click(switchByName('微信通知'))

  await waitFor(() => {
    expect(onSave).toHaveBeenCalledTimes(1)
  })
  expect(onSave.mock.calls[0]?.[0]).toEqual({ expectedRevision: 3, patch: { wechatNotificationsEnabled: false } })
  expect(state.server.wechatNotificationsEnabled).toBe(false)
  await waitFor(() => expect(document.querySelector('[data-token-monitor-settings-save-state="saved"]')).not.toBeNull())
  expect(screen.queryByText('改动已自动保存。')).toBeNull()
  expect(screen.queryByText('开关和数字改动会自动保存，无需额外点击保存。')).toBeNull()
  expect(screen.queryByRole('button', { name: '保存设置' })).toBeNull()
  expect(screen.queryByRole('button', { name: '关闭' })).toBeNull()
})

it('连续快速切换开关时请求串行发送，不会用同一个 revision 并发写入', async () => {
  const { onSave, state } = mount({ delayMs: 5 })

  fireEvent.click(switchByName('微信通知'))
  fireEvent.click(switchByName('鲸鱼娘通知气泡'))

  await waitFor(() => {
    expect(onSave).toHaveBeenCalledTimes(2)
  })
  expect(state.maxInflight).toBe(1)
  expect(onSave.mock.calls[0]?.[0]).toEqual({ expectedRevision: 3, patch: { wechatNotificationsEnabled: false } })
  expect(onSave.mock.calls[1]?.[0]).toEqual({ expectedRevision: 4, patch: { whaleBubbleEnabled: false } })
  expect(state.server).toMatchObject({ wechatNotificationsEnabled: false, whaleBubbleEnabled: false })
  await waitFor(() => expect(document.querySelector('[data-token-monitor-settings-save-state="saved"]')).not.toBeNull())
})

it('数字输入在失焦时保存，回车同样提交', async () => {
  const { onSave } = mount()
  const threshold = screen.getByLabelText(/缓存命中率阈值/) as HTMLInputElement

  fireEvent.focus(threshold)
  fireEvent.change(threshold, { target: { value: '85' } })
  expect(onSave).not.toHaveBeenCalled()
  fireEvent.blur(threshold)
  await waitFor(() => {
    expect(onSave).toHaveBeenCalledTimes(1)
  })
  expect(onSave.mock.calls[0]?.[0]).toEqual({ expectedRevision: 3, patch: { cacheHitAnomalyThreshold: 85 } })

  const budget = screen.getByLabelText(/预算阈值/) as HTMLInputElement
  fireEvent.focus(budget)
  fireEvent.change(budget, { target: { value: '12.5' } })
  fireEvent.keyDown(budget, { key: 'Enter' })
  await waitFor(() => {
    expect(onSave).toHaveBeenCalledTimes(2)
  })
  expect(onSave.mock.calls[1]?.[0]).toEqual({ expectedRevision: 4, patch: { dailyBudgetCny: 12.5 } })
})

it('非法数字只提示、不写入设置，仍保留用户输入等待修正', async () => {
  const { onSave } = mount()
  const threshold = screen.getByLabelText(/缓存命中率阈值/) as HTMLInputElement

  fireEvent.focus(threshold)
  fireEvent.change(threshold, { target: { value: '150' } })
  fireEvent.blur(threshold)

  expect(await screen.findByText('缓存命中率阈值必须是 0 到 100 的整数；这项改动没有保存。')).toBeDefined()
  expect(onSave).not.toHaveBeenCalled()
  expect(threshold.value).toBe('150')
})

it('其他数字框的非法值同样只提示、不写入', async () => {
  const consecutiveMount = mount()
  const consecutive = screen.getByLabelText(/连续低于次数/) as HTMLInputElement
  fireEvent.focus(consecutive)
  fireEvent.change(consecutive, { target: { value: '1' } })
  fireEvent.keyDown(consecutive, { key: 'Enter' })
  expect(await screen.findByText('连续低于次数必须是 2 到 20 的整数；这项改动没有保存。')).toBeDefined()
  expect(consecutiveMount.onSave).not.toHaveBeenCalled()
  cleanup()

  const budgetMount = mount()
  const budget = screen.getByLabelText(/预算阈值/) as HTMLInputElement
  fireEvent.focus(budget)
  fireEvent.change(budget, { target: { value: '1.234' } })
  fireEvent.keyDown(budget, { key: 'Enter' })
  expect(await screen.findByText('每日预算必须大于 0、不超过 1000000，且最多两位小数；这项改动没有保存。')).toBeDefined()
  expect(budgetMount.onSave).not.toHaveBeenCalled()
})

it('保存失败时保留用户改动并显示错误', async () => {
  const options: MountOptions = {}
  const { onSave } = mount(options)
  options.failure = '版本冲突，请重新打开设置。'

  fireEvent.click(switchByName('微信通知'))

  expect(await screen.findByText('版本冲突，请重新打开设置。')).toBeDefined()
  expect(onSave).toHaveBeenCalledTimes(1)
  await waitFor(() => {
    expect(switchByName('微信通知').getAttribute('aria-checked')).toBe('false')
  })
})

it('关闭只走上方的关闭图标，且关闭前会提交尚未失焦的数字输入', async () => {
  const { onSave, onClose } = mount()
  const threshold = screen.getByLabelText(/缓存命中率阈值/) as HTMLInputElement

  fireEvent.focus(threshold)
  fireEvent.change(threshold, { target: { value: '85' } })
  fireEvent.click(screen.getByRole('button', { name: '关闭监控设置' }))

  await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
  await waitFor(() => {
    expect(onSave).toHaveBeenCalledTimes(1)
  })
  expect(onSave.mock.calls[0]?.[0]).toEqual({ expectedRevision: 3, patch: { cacheHitAnomalyThreshold: 85 } })
})

it('服务器快照刷新后不会覆盖用户正在输入的数字', async () => {
  const { state } = mount()
  const threshold = screen.getByLabelText(/缓存命中率阈值/) as HTMLInputElement

  fireEvent.focus(threshold)
  fireEvent.change(threshold, { target: { value: '85' } })
  // 其他来源的刷新（例如父级重新拉取设置）不应把正在编辑的输入框改回服务器值。
  fireEvent.click(switchByName('微信通知'))
  await waitFor(() => {
    expect(state.server.wechatNotificationsEnabled).toBe(false)
  })
  expect(threshold.value).toBe('85')
})

it('比已确认版本更旧的快照不会把开关改回旧值', async () => {
  const { view, onSave, snapshotFor, element } = mount()

  fireEvent.click(switchByName('微信通知'))
  await waitFor(() => {
    expect(onSave).toHaveBeenCalledTimes(1)
  })
  expect(switchByName('微信通知').getAttribute('aria-checked')).toBe('false')

  // 与自动保存交错返回的旧快照（revision 3）不应把开关改回开启。
  view.rerender(element(snapshotFor(3, { wechatNotificationsEnabled: true })))
  expect(switchByName('微信通知').getAttribute('aria-checked')).toBe('false')

  // 更新的快照（revision 9）仍然照常采纳。
  view.rerender(element(snapshotFor(9, { wechatNotificationsEnabled: true, whaleBubbleEnabled: false })))
  await waitFor(() => {
    expect(switchByName('微信通知').getAttribute('aria-checked')).toBe('true')
  })
  expect(switchByName('鲸鱼娘通知气泡').getAttribute('aria-checked')).toBe('false')
})
