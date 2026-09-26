// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi, type Mock } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import {
  DEFAULT_TOKEN_MONITOR_SETTINGS,
  type TokenMonitorSettingsPatchRequest,
  type TokenMonitorSettingsSnapshot,
} from '../../../util/token-monitor-contract/src/index.ts'
import { TokenMonitorSettingsPanel } from '../src/client/TokenMonitorSettingsPanel.tsx'
import {
  WechatConnectionApiError,
  type WechatConnectionApi,
  type WechatRuntimeStatus,
} from '../src/client/wechatConnectionApi.ts'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const snapshot: TokenMonitorSettingsSnapshot = {
  schemaVersion: 3,
  revision: 7,
  settings: { ...DEFAULT_TOKEN_MONITOR_SETTINGS },
}

function runtime(overrides: Partial<WechatRuntimeStatus> = {}): WechatRuntimeStatus {
  return {
    schemaVersion: 1,
    provider: 'clawbot-wechat',
    availability: 'available',
    auth: 'unconfigured',
    process: 'none',
    delivery: 'not-ready',
    operation: 'idle',
    capabilities: { canLogin: true, canReconnect: false, canDisconnect: false },
    checkedAt: Date.now(),
    ...overrides,
  }
}

interface MockWechatConnectionApi {
  status: Mock<WechatConnectionApi['status']>
  login: Mock<WechatConnectionApi['login']>
  confirmLogin: Mock<WechatConnectionApi['confirmLogin']>
  reconnect: Mock<WechatConnectionApi['reconnect']>
  disconnect: Mock<WechatConnectionApi['disconnect']>
  testMessage: Mock<WechatConnectionApi['testMessage']>
}

function api(status = runtime()): MockWechatConnectionApi {
  return {
    status: vi.fn().mockResolvedValue(status),
    login: vi.fn(),
    confirmLogin: vi.fn(),
    reconnect: vi.fn(),
    disconnect: vi.fn(),
    testMessage: vi.fn(),
  }
}

function renderPanel(options: {
  currentSnapshot?: TokenMonitorSettingsSnapshot
  wechatApi?: WechatConnectionApi
  onSave?: (request: TokenMonitorSettingsPatchRequest) => Promise<TokenMonitorSettingsSnapshot>
} = {}) {
  const onSave = options.onSave ?? vi.fn().mockResolvedValue(options.currentSnapshot ?? snapshot)
  const onClose = vi.fn()
  const wechatApi = options.wechatApi ?? api()
  render(
    <TokenMonitorSettingsPanel
      snapshot={options.currentSnapshot ?? snapshot}
      onSave={onSave}
      onClose={onClose}
      wechatApi={wechatApi}
    />,
  )
  return { onSave, onClose, wechatApi }
}

describe('TokenMonitorSettingsPanel', () => {
  it('uses the compact overview layout and outfit-blue theme', () => {
    renderPanel()

    const panel = screen.getByRole('form', { name: 'Token Monitor 设置' })
    expect(panel.getAttribute('data-token-monitor-settings-theme')).toBe('whale-outfit-blue')
    expect(screen.getByRole('heading', { name: '概览' })).not.toBeNull()
    expect(screen.getByRole('heading', { name: '提醒规则' })).not.toBeNull()
    expect(screen.getByRole('heading', { name: '通知渠道' })).not.toBeNull()
    expect(screen.getByText('消费')).not.toBeNull()
    expect(screen.getByText('请求数')).not.toBeNull()
    expect(screen.getByText('Token 总数')).not.toBeNull()
    expect(screen.getByText('缓存命中 Token')).not.toBeNull()
    expect(screen.getByText('缓存命中率')).not.toBeNull()
    expect(screen.getByText('活跃天数')).not.toBeNull()
    expect(screen.getByRole('radiogroup', { name: '概览时间范围' })).not.toBeNull()
    expect(screen.getByRole('radio', { name: '今日' })).not.toBeNull()
    expect(screen.queryByText('CNY 38.67')).toBeNull()
    expect(screen.queryByRole('switch', { name: /显示鲸鱼娘/ })).toBeNull()
    expect(screen.queryByText('账户余额')).toBeNull()
    expect(screen.queryByText('剩余预算')).toBeNull()
    expect(screen.queryByText('超额后显示负数')).toBeNull()
    expect(screen.queryByText('计费状态')).toBeNull()
    expect(screen.queryByText('管理每日预算与峰谷边界提醒。')).toBeNull()
    expect(screen.queryByText('鲸鱼娘气泡与微信通知共用一处管理。')).toBeNull()
    expect(screen.queryByText(/上限 ¥/)).toBeNull()

    const metrics = panel.querySelectorAll<HTMLElement>('.token-monitor-settings__metric')
    expect(metrics).toHaveLength(6)
    expect(Array.from(metrics).every(metric => metric.style.backgroundImage === '')).toBe(true)
    const ribbon = panel.querySelector<HTMLElement>('.token-monitor-settings__ribbon')
    expect(ribbon?.getAttribute('title')).toBeNull()
  })

  it('switches overview range through the single-line segmented selector', () => {
    renderPanel()

    const today = screen.getByRole('radio', { name: '今日' })
    const thirtyDays = screen.getByRole('radio', { name: '30天' })
    expect(today.getAttribute('aria-checked')).toBe('true')
    expect(thirtyDays.getAttribute('aria-checked')).toBe('false')

    fireEvent.click(thirtyDays)
    expect(today.getAttribute('aria-checked')).toBe('false')
    expect(thirtyDays.getAttribute('aria-checked')).toBe('true')
  })

  it('renders the settings snapshot and preserves disabled child choices', async () => {
    renderPanel({
      currentSnapshot: {
        ...snapshot,
        settings: {
          ...snapshot.settings,
          dailyBudgetEnabled: true,
          budgetExceededNotificationEnabled: true,
          peakReminderEnabled: true,
          peakReminderEnterPeak: true,
          peakReminderEnterValley: true,
        },
      },
    })

    const peak = screen.getByRole('switch', { name: /峰谷提醒总开关/ })
    const enterPeak = screen.getByRole('switch', { name: /进入峰时段/ })
    const enterValley = screen.getByRole('switch', { name: /进入谷时段/ })
    expect(peak.getAttribute('aria-checked')).toBe('true')
    expect(enterPeak.getAttribute('aria-checked')).toBe('true')
    expect(enterValley.getAttribute('aria-checked')).toBe('true')

    fireEvent.click(peak)
    expect((enterPeak as HTMLButtonElement).disabled).toBe(true)
    expect((enterValley as HTMLButtonElement).disabled).toBe(true)
    expect(enterPeak.getAttribute('aria-checked')).toBe('true')
    expect(enterValley.getAttribute('aria-checked')).toBe('true')

    const budget = screen.getByRole('switch', { name: /启用今日预算/ })
    const threshold = screen.getByRole('textbox', { name: /预算阈值/ })
    expect((threshold as HTMLInputElement).value).toBe('10')
    fireEvent.click(budget)
    expect((threshold as HTMLInputElement).disabled).toBe(true)
    const exceeded = screen.getByRole('switch', { name: /超过预算时提醒/ }) as HTMLButtonElement
    expect(exceeded.disabled).toBe(true)

    await screen.findByText('尚未登录')
  })

  it('keeps switch and close interactions inside the panel instead of bubbling to the owner', async () => {
    const onClose = vi.fn()
    const outerPointerDown = vi.fn()
    const outerClick = vi.fn()
    const wechatApi = api()
    render(
      <div onPointerDown={outerPointerDown} onClick={outerClick}>
        <TokenMonitorSettingsPanel
          snapshot={snapshot}
          onSave={vi.fn().mockResolvedValue(snapshot)}
          onClose={onClose}
          wechatApi={wechatApi}
        />
      </div>,
    )

    const switchControl = screen.getByRole('switch', { name: /鲸鱼娘通知气泡/ })
    fireEvent.pointerDown(switchControl)
    fireEvent.click(switchControl)
    expect(outerPointerDown).not.toHaveBeenCalled()
    expect(outerClick).not.toHaveBeenCalled()
    expect(switchControl.getAttribute('aria-checked')).toBe('true')

    const close = screen.getByRole('button', { name: '关闭' })
    fireEvent.pointerDown(close)
    fireEvent.click(close)
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(outerPointerDown).not.toHaveBeenCalled()
    expect(outerClick).not.toHaveBeenCalled()
  })

  it('closes on Escape without submitting the form, while confirmation Escape stays local', async () => {
    const onClose = vi.fn()
    const onSave = vi.fn().mockResolvedValue(snapshot)
    const managed = runtime({
      auth: 'authenticated',
      process: 'host-managed-running',
      delivery: 'ready',
      capabilities: { canLogin: false, canReconnect: true, canDisconnect: true },
    })
    render(
      <TokenMonitorSettingsPanel
        snapshot={snapshot}
        onSave={onSave}
        onClose={onClose}
        wechatApi={api(managed)}
      />,
    )
    await screen.findByText('已登录 · DSH Host 托管运行中')

    fireEvent.keyDown(screen.getByRole('form', { name: 'Token Monitor 设置' }), { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onSave).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '断开' }))
    const confirmation = screen.getByRole('alertdialog', { name: '确认断开微信连接' })
    fireEvent.keyDown(confirmation, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('alertdialog', { name: '确认断开微信连接' })).toBeTruthy()
  })

  it('saves only changed fields exposed by this panel', async () => {
    const onSave = vi.fn().mockResolvedValue({
      ...snapshot,
      revision: 8,
      settings: { ...snapshot.settings, wechatNotificationsEnabled: true },
    })
    renderPanel({ onSave })

    fireEvent.click(screen.getByRole('switch', { name: /^微信通知/ }))
    fireEvent.click(screen.getByRole('button', { name: '保存设置' }))

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith({
        expectedRevision: 7,
        patch: { wechatNotificationsEnabled: true },
      })
    })
    expect(await screen.findByText('设置已保存。')).not.toBeNull()
  })

  it('does not expose whale-girl visibility in detailed settings', () => {
    renderPanel()
    expect(screen.queryByRole('switch', { name: /显示鲸鱼娘/ })).toBeNull()
  })

  it('edits and saves the health bar full-HP value, rejecting an out-of-range draft', async () => {
    const onSave = vi.fn().mockResolvedValue({
      ...snapshot,
      revision: 8,
      settings: { ...snapshot.settings, healthBarMaxCny: 250.5 },
    })
    renderPanel({ onSave })

    const input = screen.getByRole('textbox', { name: /满血值/ }) as HTMLInputElement
    expect(input.value).toBe('100')

    // A draft the Host would reject never leaves the panel.
    fireEvent.change(input, { target: { value: '0' } })
    fireEvent.click(screen.getByRole('button', { name: '保存设置' }))
    expect(onSave).not.toHaveBeenCalled()
    expect(await screen.findByText(/血条满血值必须在/)).not.toBeNull()

    fireEvent.change(input, { target: { value: '250.5' } })
    fireEvent.click(screen.getByRole('button', { name: '保存设置' }))
    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith({ expectedRevision: 7, patch: { healthBarMaxCny: 250.5 } })
    })
  })

  it('keeps a failed save visible without reporting success', async () => {
    renderPanel({ onSave: vi.fn().mockRejectedValue(new Error('revision conflict')) })
    fireEvent.click(screen.getByRole('switch', { name: /^微信通知/ }))
    fireEvent.click(screen.getByRole('button', { name: '保存设置' }))
    expect(((await screen.findByRole('button', { name: '保存设置' })) as HTMLButtonElement).disabled).toBe(false)
    expect(await screen.findByText('revision conflict')).not.toBeNull()
    expect(screen.queryByText('设置已保存。')).toBeNull()
  })

  it('marks an external bridge as externally managed and disables destructive actions', async () => {
    renderPanel({
      wechatApi: api(runtime({
        auth: 'authenticated',
        process: 'external',
        delivery: 'ready',
        capabilities: { canLogin: false, canReconnect: false, canDisconnect: false },
        identity: { maskedUserId: 'abcd***wxyz' },
      })),
    })

    expect(await screen.findByText('外部 bridge 正在运行（非 DSH Host 管理）')).not.toBeNull()
    expect(screen.getByText(/为避免误杀/)).not.toBeNull()
    expect((screen.getByRole('button', { name: '重连' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: '断开' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText('账号 abcd***wxyz')).not.toBeNull()
  })

  it('keeps the login QR in component memory and confirms the short-lived session', async () => {
    const pending = runtime({
      auth: 'pending',
      process: 'host-managed-running',
      capabilities: { canLogin: true, canReconnect: true, canDisconnect: true },
      pendingLogin: { sessionId: 'session-1', phase: 'waiting', expiresAt: Date.now() + 60_000 },
    })
    const connected = runtime({
      auth: 'authenticated',
      process: 'host-managed-running',
      delivery: 'needs-activation',
      capabilities: { canLogin: false, canReconnect: true, canDisconnect: true },
      identity: { maskedUserId: 'abcd***wxyz' },
    })
    const wechatApi = api(runtime())
    wechatApi.login.mockResolvedValue({
      login: { sessionId: 'session-1', expiresAt: Date.now() + 60_000, qrPayload: 'https://ilinkai.weixin.qq.com/cli/login?ticket=short-lived-qr-payload' },
      status: pending,
    })
    wechatApi.confirmLogin.mockResolvedValue({ result: 'confirmed', status: connected })
    const storageWrite = vi.spyOn(Storage.prototype, 'setItem')
    renderPanel({ wechatApi })
    await screen.findByText('尚未登录')

    fireEvent.click(screen.getByRole('button', { name: '登录微信' }))
    const qr = await screen.findByLabelText('微信登录二维码内容')
    expect(qr.tagName).toBe('IMG')
    expect((qr as HTMLImageElement).src).toMatch(/^data:image\/svg\+xml/)
    expect((qr as HTMLImageElement).src).not.toContain('api.qrserver.com')
    expect(screen.getByText('二维码无法加载？打开登录链接')).not.toBeNull()
    expect((screen.getByRole('link') as HTMLAnchorElement).href).toBe('https://ilinkai.weixin.qq.com/cli/login?ticket=short-lived-qr-payload')
    expect(storageWrite).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '确认登录状态' }))
    await waitFor(() => {
      expect(wechatApi.confirmLogin).toHaveBeenCalledWith('session-1', expect.any(AbortSignal))
    })
    expect(await screen.findByText('微信登录已确认。')).not.toBeNull()
    expect(screen.queryByLabelText('微信登录二维码内容')).toBeNull()
    expect(screen.getByText('请先给 ClawBot 发一条消息激活通知通道')).not.toBeNull()
  })

  it('requires explicit confirmation before disconnecting a Host-owned bridge', async () => {
    const managed = runtime({
      auth: 'authenticated',
      process: 'host-managed-running',
      delivery: 'ready',
      capabilities: { canLogin: false, canReconnect: true, canDisconnect: true },
    })
    const stopped = runtime({
      auth: 'authenticated',
      process: 'host-managed-stopped',
      capabilities: { canLogin: false, canReconnect: true, canDisconnect: false },
    })
    const wechatApi = api(managed)
    wechatApi.disconnect.mockResolvedValue(stopped)
    renderPanel({ wechatApi })
    await screen.findByText('已登录 · DSH Host 托管运行中')

    fireEvent.click(screen.getByRole('button', { name: '断开' }))
    expect(wechatApi.disconnect).not.toHaveBeenCalled()
    expect(screen.getByRole('alertdialog', { name: '确认断开微信连接' })).not.toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '确认断开' }))
    await waitFor(() => {
      expect(wechatApi.disconnect).toHaveBeenCalledTimes(1)
    })
    expect(await screen.findByText('DSH Host 管理的微信 bridge 已断开。')).not.toBeNull()
  })

  it('surfaces BRIDGE_NOT_OWNED and aborts pending status work on unmount', async () => {
    let observedSignal: AbortSignal | undefined
    const wechatApi = api(runtime({
      capabilities: { canLogin: true, canReconnect: true, canDisconnect: true },
    }))
    wechatApi.reconnect.mockRejectedValue(
      new WechatConnectionApiError(409, 'BRIDGE_NOT_OWNED', '微信 bridge 不由 DSH Host 管理'),
    )
    const pendingApi = api()
    pendingApi.status.mockImplementation((signal) => {
      observedSignal = signal
      return new Promise(() => {})
    })

    const first = renderPanel({ wechatApi })
    await screen.findByText('尚未登录')
    fireEvent.click(screen.getByRole('button', { name: '重连' }))
    expect(await screen.findByText('当前微信 bridge 不由 DSH Host 管理，不能在这里重连或断开。')).not.toBeNull()
    cleanup()

    const second = renderPanel({ wechatApi: pendingApi })
    expect(observedSignal?.aborted).toBe(false)
    second.onClose()
    cleanup()
    expect(observedSignal?.aborted).toBe(true)
    expect(first.onClose).not.toHaveBeenCalled()
  })

  it('sends a test message only when delivery is ready and surfaces success/failure', async () => {
    const wechatApi = api(runtime({
      auth: 'authenticated', process: 'host-managed-running', delivery: 'ready',
      capabilities: { canLogin: false, canReconnect: true, canDisconnect: true },
    }))
    wechatApi.testMessage.mockResolvedValue({ ok: true })
    renderPanel({ wechatApi })
    await screen.findByText('消息通道已激活')
    fireEvent.click(screen.getByRole('button', { name: '发送测试消息' }))
    await waitFor(() => expect(wechatApi.testMessage).toHaveBeenCalledWith(
      expect.stringContaining('【dsh-damage-pulse】'),
      expect.any(AbortSignal),
    ))
    expect(wechatApi.testMessage).toHaveBeenCalledWith(
      expect.stringContaining('欢迎去 GitHub 给 dsh-damage-pulse 点一颗 Star 呀'),
      expect.any(AbortSignal),
    )
    expect(wechatApi.testMessage.mock.calls[0]?.[0]).toMatch(/最大动力！\(≧▽≦\)♡$/)
    expect(await screen.findByText('测试消息已发送。')).not.toBeNull()

    const failedApi = api(runtime({
      auth: 'authenticated', process: 'host-managed-running', delivery: 'ready',
      capabilities: { canLogin: false, canReconnect: true, canDisconnect: true },
    }))
    failedApi.testMessage.mockRejectedValue(new WechatConnectionApiError(409, 'ACTIVATION_REQUIRED', '微信通知通道需要先激活'))
    cleanup()
    renderPanel({ wechatApi: failedApi })
    await screen.findByText('消息通道已激活')
    fireEvent.click(screen.getByRole('button', { name: '发送测试消息' }))
    expect(await screen.findByText('微信通知通道需要先激活')).not.toBeNull()
  })

  it('keeps long footer messages wrappable and narrow-screen wechat rows stacked', () => {
    renderPanel()

    const panel = screen.getByRole('form', { name: 'Token Monitor 设置' })
    const style: string = panel.querySelector<HTMLStyleElement>('style')?.textContent ?? ''
    expect(style).toContain('.token-monitor-settings__footer { position: sticky; bottom: 0; z-index: 3; display: flex; flex-wrap: wrap;')
    expect(style).toContain('.token-monitor-settings__footer-message { flex: 1 1 180px; min-width: 0; overflow-wrap: anywhere; word-break: break-word; }')
    expect(style).toContain('.token-monitor-settings__footer > button { flex: 0 0 auto; }')

    const mediaLine = style.split('\n').find(line => line.includes('@media (max-width: 719px)'))
    expect(mediaLine).toBeDefined()
    expect(mediaLine).toContain('.token-monitor-settings__wechat-actions-short, .token-monitor-settings__wechat-actions-long { grid-template-columns: 1fr; }')
    expect(mediaLine).toContain('.token-monitor-settings__wechat-refresh { min-width: 0; }')

    const footer = panel.querySelector<HTMLElement>('.token-monitor-settings__footer')
    expect(footer).not.toBeNull()
    const message = footer?.querySelector<HTMLElement>('.token-monitor-settings__footer-message')
    expect(message?.getAttribute('aria-live')).toBe('polite')
    expect(message?.textContent ?? '').not.toMatch(/undefined/)
    expect(footer?.querySelector<HTMLButtonElement>('button[type="button"]')).not.toBeNull()
    expect(footer?.querySelector<HTMLButtonElement>('button[type="submit"]')).not.toBeNull()
  })

  it('uses the wrap-friendly actions container inside the disconnect confirmation', async () => {
    const managed = runtime({
      auth: 'authenticated',
      process: 'host-managed-running',
      delivery: 'ready',
      capabilities: { canLogin: false, canReconnect: true, canDisconnect: true },
    })
    renderPanel({ wechatApi: api(managed) })
    await screen.findByText('已登录 · DSH Host 托管运行中')

    fireEvent.click(screen.getByRole('button', { name: '断开' }))
    const confirmation = screen.getByRole('alertdialog', { name: '确认断开微信连接' })
    const actions = confirmation.querySelector<HTMLElement>('.token-monitor-settings__disconnect-actions')
    expect(actions).not.toBeNull()
    expect(actions?.querySelector('button')?.textContent).toBe('取消')
    expect(screen.getByRole('button', { name: '确认断开' })).not.toBeNull()

    const panel = screen.getByRole('form', { name: 'Token Monitor 设置' })
    const style: string = panel.querySelector<HTMLStyleElement>('style')?.textContent ?? ''
    expect(style).toContain('.token-monitor-settings__disconnect-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }')
    expect(style).toContain('.token-monitor-settings__disconnect-actions > button { flex: 1 1 112px; min-width: 0; }')
  })
})
