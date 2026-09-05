import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type ReactNode,
} from 'react'
import {
  TOKEN_MONITOR_MAX_DAILY_BUDGET_CNY,
  type TokenMonitorSettings,
  type TokenMonitorSettingsPatch,
  type TokenMonitorSettingsPatchRequest,
  type TokenMonitorSettingsSnapshot,
} from '../../../../util/token-monitor-contract/src/index.ts'
import {
  WechatConnectionApiError,
  type WechatConnectionApi,
  type WechatLoginConfirmation,
  type WechatRuntimeStatus,
} from './wechatConnectionApi.ts'
import type { UsageSummary, UsageSummaryRange } from './types.ts'
import { formatChineseCompactCurrency, formatChineseCompactNumber } from './compactNumber.ts'
import { createTokenMonitorUpdateApi, TokenMonitorUpdateApiError, type TokenMonitorUpdateStatus } from './updateApi.ts'
import { toString as renderQrSvg } from 'qrcode/lib/browser.js'

const CUTE_ASSET_ROOT = '/assets/dsh-token-monitor/settings-ui/cute'
function cuteAsset(name: string): string { return `${CUTE_ASSET_ROOT}/${name}.png` }

const SETTINGS_KEYS = [
  'dailyBudgetEnabled',
  'dailyBudgetCny',
  'budgetExceededNotificationEnabled',
  'peakReminderEnabled',
  'peakReminderEnterPeak',
  'peakReminderEnterValley',
  'whaleBubbleEnabled',
  'wechatNotificationsEnabled',
  'cacheHitAnomalyNotificationEnabled',
  'cacheHitAnomalyThreshold',
  'cacheHitAnomalyConsecutiveCalls',
] as const satisfies readonly (keyof TokenMonitorSettings)[]

type EditableSettingsKey = typeof SETTINGS_KEYS[number]

interface LoginSession {
  sessionId: string
  expiresAt: number
  qrPayload: string
}

export interface TokenMonitorSettingsPanelProps {
  snapshot: TokenMonitorSettingsSnapshot
  onSave(request: TokenMonitorSettingsPatchRequest): Promise<TokenMonitorSettingsSnapshot>
  onClose(): void
  wechatApi: WechatConnectionApi
  /**
   * Optional local-only renderer. The component never sends the short-lived QR payload
   * anywhere except to this callback and never writes it to browser storage.
   */
  renderLoginQr?(payload: string): ReactNode
}

const PANEL: CSSProperties = {
  width: 'min(760px, calc(100vw - 24px))',
  maxHeight: 'min(760px, calc(100vh - 24px))',
  overflow: 'auto',
  border: '1px solid #c6d4f2',
  borderRadius: 23,
  background: 'linear-gradient(155deg, #fbfcff, #eef3ff 58%, #fff)',
  color: '#283868',
  boxShadow: '0 24px 70px rgba(40, 56, 104, 0.22), inset 0 0 0 5px rgba(238, 243, 255, 0.72)',
  fontFamily: 'var(--dsh-font-family, ui-sans-serif, system-ui, sans-serif)',
}

const SECTION: CSSProperties = {
  minWidth: 0,
  margin: 0,
  padding: 14,
  border: '1px solid rgba(56, 88, 168, 0.20)',
  borderRadius: 16,
  background: 'rgba(255, 255, 255, 0.88)',
  boxShadow: '0 7px 18px rgba(40, 56, 104, 0.08)',
}

const BUTTON: CSSProperties = {
  minHeight: 36,
  padding: '7px 13px',
  border: '1px solid rgba(56, 88, 168, 0.38)',
  borderRadius: 10,
  background: '#f5f7ff',
  color: '#283868',
  cursor: 'pointer',
  font: 'inherit',
  fontSize: 13,
  fontWeight: 650,
}

const PRIMARY_BUTTON: CSSProperties = {
  ...BUTTON,
  borderColor: 'transparent',
  background: 'linear-gradient(135deg, #3858a8, #476fc4)',
  color: '#fff',
  boxShadow: '0 7px 18px rgba(56, 88, 168, 0.24)',
}

function descriptionStyle(disabled = false): CSSProperties {
  return { marginTop: 3, color: '#6874a8', fontSize: 12, lineHeight: 1.45, opacity: disabled ? 0.62 : 1 }
}

function errorMessage(error: unknown): string {
  if (error instanceof WechatConnectionApiError && error.code === 'BRIDGE_NOT_OWNED') {
    return '当前微信 bridge 不由 DSH Host 管理，不能在这里重连或断开。'
  }
  return error instanceof Error ? error.message : '操作失败，请稍后重试。'
}

/**
 * ClawBot returns the short-lived login payload rather than image bytes. Keep
 * it in component memory and encode the QR as an SVG data URL in the browser;
 * the direct login link remains available as a local fallback.
 */
function LocalLoginQr({ payload }: { payload: string }): ReactNode {
  const [src, setSrc] = useState<string>()
  useEffect(() => {
    let cancelled = false
    setSrc(undefined)
    void renderQrSvg(payload, { type: 'svg', width: 180, margin: 1, errorCorrectionLevel: 'M' })
      .then((svg) => {
        if (!cancelled) setSrc(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`)
      })
      .catch(() => { if (!cancelled) setSrc(undefined) })
    return () => { cancelled = true }
  }, [payload])
  if (src === undefined) return <span>正在生成二维码…</span>
  return <img aria-label="微信登录二维码内容" data-wechat-qr-image="" src={src} alt="微信登录二维码" width="180" height="180" />
}

function connectionSummary(status: WechatRuntimeStatus | undefined): string {
  if (status === undefined) return '正在读取运行状态…'
  if (status.availability === 'unsupported') return '当前环境不支持微信连接'
  if (status.process === 'external') return '外部 bridge 正在运行（非 DSH Host 管理）'
  if (status.auth === 'authenticated' && status.process === 'host-managed-running') return '已登录 · DSH Host 托管运行中'
  if (status.auth === 'authenticated' && status.process === 'host-managed-stopped') return '已登录 · Host bridge 已停止'
  if (status.auth === 'pending') return '等待扫码确认'
  if (status.auth === 'expired') return '登录已过期'
  if (status.auth === 'unconfigured') return '尚未登录'
  return '状态暂不可确定'
}

function deliverySummary(status: WechatRuntimeStatus | undefined): string | undefined {
  if (status === undefined || status.auth !== 'authenticated') return undefined
  if (status.delivery === 'ready') return '消息通道已激活'
  if (status.delivery === 'needs-activation') return '请先给 ClawBot 发一条消息激活通知通道'
  if (status.delivery === 'not-ready') return '消息通道尚未就绪'
  return '消息通道状态未知'
}

function capabilityHint(status: WechatRuntimeStatus | undefined): string | undefined {
  if (status?.process === 'external') return '这个 bridge 由外部进程管理。为避免误杀，重连和断开均已禁用。'
  if (status !== undefined && !status.capabilities.canReconnect && !status.capabilities.canDisconnect) {
    return '当前连接不由 DSH Host 管理，不能在此重连或断开。'
  }
  return undefined
}

function SwitchField(props: {
  id: string
  label: string
  checked: boolean
  disabled?: boolean
  indent?: boolean
  onChange(value: boolean): void
}): ReactNode {
  const { id, label, checked, disabled = false, indent = false } = props
  return (
    <div className={`token-monitor-settings__switch-field${indent ? ' token-monitor-settings__switch-field--indent' : ''}`}>
      <label htmlFor={id} style={{ flex: 1, minWidth: 0, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.58 : 1 }}>
        <span style={{ display: 'block', fontSize: 14, fontWeight: 650 }}>{label}</span>
      </label>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => { props.onChange(!checked) }}
        style={{
          position: 'relative',
          width: 42,
          height: 24,
          flex: '0 0 auto',
          padding: 0,
          border: '1px solid rgba(40, 56, 104, 0.18)',
          borderRadius: 999,
          background: checked ? 'linear-gradient(135deg, #3858a8, #476fc4)' : 'rgba(104, 116, 168, 0.22)',
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.58 : 1,
          transition: 'background 160ms ease',
        }}
      >
        <span
          aria-hidden="true"
          style={{
            position: 'absolute',
            top: 2,
            left: checked ? 20 : 2,
            width: 18,
            height: 18,
            borderRadius: '50%',
            background: '#fff',
            boxShadow: '0 2px 6px rgba(40, 56, 104, 0.26)',
            transition: 'left 160ms ease',
          }}
        />
      </button>
    </div>
  )
}

function SectionTitle({ title, iconName }: { title: string; iconName?: string }): ReactNode {
  return (
    <div className="token-monitor-settings__section-title">
      {iconName !== undefined && <img src={cuteAsset(iconName)} alt="" width="28" height="28" style={{ objectFit: 'contain', flex: '0 0 auto' }} />}
      <h2 style={{ margin: 0, fontSize: 15, lineHeight: 1.35 }}>{title}</h2>
    </div>
  )
}

function metricTitle(value: number, prefix = '', suffix = ''): string {
  return `${prefix}${value.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}${suffix}`
}

const SUMMARY_RANGES: readonly { value: UsageSummaryRange; label: string }[] = [
  { value: 'all', label: '可用历史' },
  { value: '30d', label: '30天' },
  { value: '7d', label: '7天' },
  { value: 'today', label: '今日' },
]

function SummaryRangeSelector({ value, onChange }: { value: UsageSummaryRange; onChange: (value: UsageSummaryRange) => void }): ReactNode {
  return (
    <div
      style={{
        minWidth: 0,
        maxWidth: '100%',
        overflowX: 'auto',
        overscrollBehaviorX: 'contain',
        scrollbarWidth: 'thin',
        scrollbarColor: '#b7c9ee transparent',
      }}
    >
      <div
        role="radiogroup"
        aria-label="概览时间范围"
        style={{
          display: 'inline-flex',
          minWidth: 'max-content',
          padding: 3,
          border: '1px solid #b8c8eb',
          borderRadius: 999,
          background: 'rgba(255, 255, 255, 0.58)',
        }}
      >
        {SUMMARY_RANGES.map((range) => {
          const selected = value === range.value
          return (
            <button
              key={range.value}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange(range.value)}
              style={{
                minHeight: 28,
                padding: '4px 13px',
                border: 0,
                borderRadius: 999,
                background: selected ? 'linear-gradient(135deg, #3858a8, #476fc4)' : 'transparent',
                color: selected ? '#fff' : '#5870a7',
                font: 'inherit',
                fontSize: 12,
                fontWeight: 700,
                lineHeight: 1.2,
                whiteSpace: 'nowrap',
                cursor: 'pointer',
                boxShadow: selected ? '0 3px 8px rgba(56, 88, 168, 0.24)' : 'none',
              }}
            >
              {range.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function actionButtonStyle(disabled: boolean, dangerous = false): CSSProperties {
  return {
    ...BUTTON,
    ...(dangerous ? { borderColor: 'rgba(204, 72, 99, 0.42)', color: '#bd3e5a' } : {}),
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.5 : 1,
  }
}

export function TokenMonitorSettingsPanel(props: TokenMonitorSettingsPanelProps): ReactNode {
  const { snapshot } = props
  const [draft, setDraft] = useState<TokenMonitorSettings>(() => ({ ...snapshot.settings }))
  const [budgetInput, setBudgetInput] = useState(() => String(snapshot.settings.dailyBudgetCny))
  const [cacheThresholdInput, setCacheThresholdInput] = useState(() => String(snapshot.settings.cacheHitAnomalyThreshold))
  const [cacheCallsInput, setCacheCallsInput] = useState(() => String(snapshot.settings.cacheHitAnomalyConsecutiveCalls))
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [saveError, setSaveError] = useState<string>()
  const [status, setStatus] = useState<WechatRuntimeStatus>()
  const [statusError, setStatusError] = useState<string>()
  const [action, setAction] = useState<'login' | 'confirm' | 'reconnect' | 'disconnect' | 'test'>()
  const [actionMessage, setActionMessage] = useState<string>()
  const [actionError, setActionError] = useState<string>()
  const [loginSession, setLoginSession] = useState<LoginSession>()
  const [disconnectConfirmation, setDisconnectConfirmation] = useState(false)
  const [summaryRange, setSummaryRange] = useState<UsageSummaryRange>('today')
  const [usageSummary, setUsageSummary] = useState<UsageSummary>()
  const [usageSummaryLoading, setUsageSummaryLoading] = useState(false)
  const [clock, setClock] = useState(() => Date.now())
  const [updateStatus, setUpdateStatus] = useState<TokenMonitorUpdateStatus>()
  const [updateAction, setUpdateAction] = useState<'check' | 'install'>()
  const [updateMessage, setUpdateMessage] = useState<string>()
  const [updateError, setUpdateError] = useState<string>()
  const mounted = useRef(true)
  const statusController = useRef<AbortController>()
  const actionController = useRef<AbortController>()
  const updateApi = useRef(createTokenMonitorUpdateApi())

  useEffect(() => {
    setDraft({ ...snapshot.settings })
    setBudgetInput(String(snapshot.settings.dailyBudgetCny))
    setCacheThresholdInput(String(snapshot.settings.cacheHitAnomalyThreshold))
    setCacheCallsInput(String(snapshot.settings.cacheHitAnomalyConsecutiveCalls))
    setSaveState('idle')
    setSaveError(undefined)
  }, [snapshot])

  useEffect(() => {
    mounted.current = true
    const controller = new AbortController()
    statusController.current = controller
    setStatusError(undefined)
    void props.wechatApi.status(controller.signal).then((nextStatus) => {
      if (mounted.current && !controller.signal.aborted) setStatus(nextStatus)
    }).catch((error: unknown) => {
      if (mounted.current && !controller.signal.aborted) setStatusError(errorMessage(error))
    })
    return () => {
      mounted.current = false
      controller.abort()
      actionController.current?.abort()
    }
  }, [props.wechatApi])

  useEffect(() => {
    const controller = new AbortController()
    setUsageSummaryLoading(true)
    void fetch('/api/token-monitor/usage-summary?range=' + summaryRange, { cache: 'no-store', signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error('概览数据读取失败')
        return await response.json() as UsageSummary
      })
      .then(summary => { if (!controller.signal.aborted) setUsageSummary(summary) })
      .catch(() => { if (!controller.signal.aborted) setUsageSummary(undefined) })
      .finally(() => { if (!controller.signal.aborted) setUsageSummaryLoading(false) })
    return () => controller.abort()
  }, [summaryRange])

  useEffect(() => {
    const expiresAt = loginSession?.expiresAt ?? status?.pendingLogin?.expiresAt
    if (expiresAt === undefined) return
    const updateClock = () => {
      const now = Date.now()
      setClock(now)
      if (loginSession !== undefined && now >= loginSession.expiresAt) {
        setLoginSession(undefined)
        setActionMessage('登录二维码已过期，请重新获取。')
      }
    }
    updateClock()
    const timer = window.setInterval(updateClock, 1_000)
    return () => { window.clearInterval(timer) }
  }, [loginSession, status?.pendingLogin?.expiresAt])

  const updateDraft = <K extends EditableSettingsKey>(key: K, value: TokenMonitorSettings[K]) => {
    setDraft(current => ({ ...current, [key]: value }))
    setSaveState('idle')
    setSaveError(undefined)
  }

  const refreshStatus = async () => {
    statusController.current?.abort()
    const controller = new AbortController()
    statusController.current = controller
    setStatusError(undefined)
    try {
      const nextStatus = await props.wechatApi.status(controller.signal)
      if (mounted.current && !controller.signal.aborted) setStatus(nextStatus)
    } catch (error) {
      if (mounted.current && !controller.signal.aborted) setStatusError(errorMessage(error))
    }
  }

  const beginAction = (nextAction: NonNullable<typeof action>): AbortController | undefined => {
    if (action !== undefined) return undefined
    const controller = new AbortController()
    actionController.current = controller
    setAction(nextAction)
    setActionError(undefined)
    setActionMessage(undefined)
    return controller
  }

  const finishAction = (controller: AbortController) => {
    if (!mounted.current || controller.signal.aborted) return
    actionController.current = undefined
    setAction(undefined)
  }

  const startLogin = async () => {
    const controller = beginAction('login')
    if (controller === undefined) return
    try {
      const result = await props.wechatApi.login(controller.signal)
      if (!mounted.current || controller.signal.aborted) return
      setStatus(result.status)
      setLoginSession(result.login)
      setClock(Date.now())
      setActionMessage('二维码已生成，请使用微信扫码后确认登录状态。')
    } catch (error) {
      if (mounted.current && !controller.signal.aborted) setActionError(errorMessage(error))
    } finally {
      finishAction(controller)
    }
  }

  const activeSessionId = loginSession?.sessionId ?? status?.pendingLogin?.sessionId

  const confirmLogin = async () => {
    if (activeSessionId === undefined) return
    const controller = beginAction('confirm')
    if (controller === undefined) return
    try {
      const result: WechatLoginConfirmation = await props.wechatApi.confirmLogin(activeSessionId, controller.signal)
      if (!mounted.current || controller.signal.aborted) return
      setStatus(result.status)
      const messages: Record<WechatLoginConfirmation['result'], string> = {
        waiting: '还在等待扫码。',
        scanned: '已扫码，请在微信中确认登录。',
        confirmed: '微信登录已确认。',
        expired: '登录二维码已过期，请重新获取。',
      }
      setActionMessage(messages[result.result])
      if (result.result === 'confirmed' || result.result === 'expired') setLoginSession(undefined)
    } catch (error) {
      if (mounted.current && !controller.signal.aborted) setActionError(errorMessage(error))
    } finally {
      finishAction(controller)
    }
  }

  const reconnect = async () => {
    const controller = beginAction('reconnect')
    if (controller === undefined) return
    try {
      const nextStatus = await props.wechatApi.reconnect(controller.signal)
      if (!mounted.current || controller.signal.aborted) return
      setStatus(nextStatus)
      setActionMessage('已请求 DSH Host 重连微信 bridge。')
    } catch (error) {
      if (mounted.current && !controller.signal.aborted) setActionError(errorMessage(error))
    } finally {
      finishAction(controller)
    }
  }

  const disconnect = async () => {
    const controller = beginAction('disconnect')
    if (controller === undefined) return
    try {
      const nextStatus = await props.wechatApi.disconnect(controller.signal)
      if (!mounted.current || controller.signal.aborted) return
      setStatus(nextStatus)
      setLoginSession(undefined)
      setDisconnectConfirmation(false)
      setActionMessage('DSH Host 管理的微信 bridge 已断开。')
    } catch (error) {
      if (mounted.current && !controller.signal.aborted) setActionError(errorMessage(error))
    } finally {
      finishAction(controller)
    }
  }

  const testMessage = async () => {
    const controller = beginAction('test')
    if (controller === undefined) return
    try {
      await props.wechatApi.testMessage([
        '【dsh-damage-pulse】',
        '',
        '连线成功啦～鲸鱼娘已经顺利抵达微信！(｡•̀ᴗ-)✧',
        '以后预算、峰谷时段和缓存小状况，我都会及时来提醒你哦～',
        '',
        '如果你喜欢这个插件，欢迎去 GitHub 给 dsh-damage-pulse 点一颗 Star 呀～你的喜欢，就是我继续努力更新的最大动力！(≧▽≦)♡',
      ].join('\n'), controller.signal)
      if (!mounted.current || controller.signal.aborted) return
      setActionMessage('测试消息已发送。')
    } catch (error) {
      if (mounted.current && !controller.signal.aborted) setActionError(errorMessage(error))
    } finally {
      finishAction(controller)
    }
  }

  const checkForUpdates = async () => {
    if (updateAction !== undefined) return
    const controller = new AbortController()
    setUpdateAction('check'); setUpdateError(undefined); setUpdateMessage(undefined)
    try {
      const result = await updateApi.current.check(controller.signal)
      if (!mounted.current || controller.signal.aborted) return
      setUpdateStatus(result)
      setUpdateMessage(result.hasUpdate ? `发现新版本 v${result.latestVersion}。` : `当前已是最新版本 v${result.currentVersion}。`)
    } catch (error) {
      if (mounted.current && !controller.signal.aborted) setUpdateError(error instanceof TokenMonitorUpdateApiError ? error.message : '检查更新失败，请稍后重试。')
    } finally { if (mounted.current && !controller.signal.aborted) setUpdateAction(undefined) }
  }

  const installUpdate = async () => {
    if (updateAction !== undefined || updateStatus?.hasUpdate !== true) return
    const controller = new AbortController()
    setUpdateAction('install'); setUpdateError(undefined); setUpdateMessage(undefined)
    try {
      const result = await updateApi.current.install(controller.signal)
      if (!mounted.current || controller.signal.aborted) return
      setUpdateStatus({ repository: result.repository, currentVersion: result.currentVersion, latestVersion: result.latestVersion, hasUpdate: result.installed ? false : result.hasUpdate, releaseUrl: result.releaseUrl, asset: result.asset })
      setUpdateMessage(result.installed ? result.message : `更新包已校验但尚未安装：${result.message}`)
    } catch (error) {
      if (mounted.current && !controller.signal.aborted) setUpdateError(error instanceof TokenMonitorUpdateApiError ? error.message : '安装更新失败，请稍后重试。')
    } finally { if (mounted.current && !controller.signal.aborted) setUpdateAction(undefined) }
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (saveState === 'saving') return
    const budget = Number(budgetInput)
    if (!Number.isFinite(budget) || budget <= 0 || budget > TOKEN_MONITOR_MAX_DAILY_BUDGET_CNY
      || Math.abs(budget * 100 - Math.round(budget * 100)) > 1e-9) {
      setSaveError(`每日预算必须大于 0、不超过 ${String(TOKEN_MONITOR_MAX_DAILY_BUDGET_CNY)}，且最多两位小数。`)
      return
    }
    const cacheThreshold = Number(cacheThresholdInput)
    const cacheCalls = Number(cacheCallsInput)
    if (!Number.isInteger(cacheThreshold) || cacheThreshold < 0 || cacheThreshold > 100) { setSaveError('缓存命中率阈值必须是 0 到 100 的整数。'); return }
    if (!Number.isInteger(cacheCalls) || cacheCalls < 2 || cacheCalls > 20) { setSaveError('连续低于次数必须是 2 到 20 的整数。'); return }
    const normalizedDraft = { ...draft, dailyBudgetCny: budget, cacheHitAnomalyThreshold: cacheThreshold, cacheHitAnomalyConsecutiveCalls: cacheCalls }
    const patch: TokenMonitorSettingsPatch = {}
    for (const key of SETTINGS_KEYS) {
      if (normalizedDraft[key] !== snapshot.settings[key]) {
        ;(patch as Record<EditableSettingsKey, TokenMonitorSettings[EditableSettingsKey]>)[key] = normalizedDraft[key]
      }
    }
    setSaveState('saving')
    setSaveError(undefined)
    try {
      const nextSnapshot = await props.onSave({ expectedRevision: snapshot.revision, patch })
      if (!mounted.current) return
      setDraft({ ...nextSnapshot.settings })
      setBudgetInput(String(nextSnapshot.settings.dailyBudgetCny))
      setSaveState('saved')
    } catch (error) {
      if (!mounted.current) return
      setSaveState('idle')
      setSaveError(error instanceof Error ? error.message : '设置保存失败，请稍后重试。')
    }
  }

  const busy = action !== undefined || status?.operation !== undefined && status.operation !== 'idle'
  const ownershipHint = capabilityHint(status)
  const expiresAt = loginSession?.expiresAt ?? status?.pendingLogin?.expiresAt
  const secondsRemaining = expiresAt === undefined ? undefined : Math.max(0, Math.ceil((expiresAt - clock) / 1_000))
  const canLogin = status?.capabilities.canLogin === true && !busy
  const canReconnect = status?.capabilities.canReconnect === true && !busy
  const canDisconnect = status?.capabilities.canDisconnect === true && !busy
  const canConfirm = activeSessionId !== undefined && secondsRemaining !== 0 && !busy
  const canTestMessage = status?.delivery === 'ready' && !busy


  return (
    <form
      aria-label="Token Monitor 设置"
      className="token-monitor-settings"
      data-token-monitor-settings-theme="whale-outfit-blue"
      onSubmit={(event) => { void submit(event) }}
      // The panel is rendered inside BalanceWidget's draggable card. Keep
      // controls and the scroll surface from re-entering the card's pointer
      // handlers (which would start a drag or close an owning overlay).
      onPointerDown={(event) => { event.stopPropagation() }}
      onPointerMove={(event) => { event.stopPropagation() }}
      onPointerUp={(event) => { event.stopPropagation() }}
      onPointerCancel={(event) => { event.stopPropagation() }}
      onClick={(event) => { event.stopPropagation() }}
      onContextMenu={(event) => { event.stopPropagation() }}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !disconnectConfirmation) props.onClose()
      }}
      style={PANEL}
    >
      <style>{`
        .token-monitor-settings { scrollbar-color: #9eb2df transparent; }
        .token-monitor-settings * { box-sizing: border-box; }
        .token-monitor-settings__head { position: sticky; top: 0; z-index: 3; display: flex; align-items: flex-start; justify-content: space-between; padding: 20px 22px 14px; border-bottom: 1px solid rgba(56,88,168,.18); background: linear-gradient(90deg,rgba(226,235,255,.97),rgba(246,248,255,.97)); overflow: hidden; }
        .token-monitor-settings__head-copy { position: relative; z-index: 1; padding-right: 82px; }
        .token-monitor-settings__ribbon { position: absolute; z-index: 1; top: 2px; right: 52px; width: 62px; height: 62px; object-fit: contain; opacity: .82; pointer-events: auto; }
        .token-monitor-settings__kicker { color: #3858a8; font-size: 10px; font-weight: 800; letter-spacing: .12em; }
        .token-monitor-settings__title { margin: 4px 0 0; color: #283868; font-size: 22px; line-height: 1.3; }
        .token-monitor-settings__close { position: relative; z-index: 2; display: grid; place-items: center; width: 34px; height: 34px; padding: 5px; border: 1px solid #c6d4f2; border-radius: 12px; background: rgba(255,255,255,.82); cursor: pointer; }
        .token-monitor-settings__close:hover { border-color: #476fc4; background: #fff; }
        .token-monitor-settings__close img { width: 100%; height: 100%; object-fit: contain; }
        .token-monitor-settings__grid { display: grid; grid-template-columns: minmax(300px,.88fr) minmax(0,1.12fr); align-items: stretch; gap: 10px; padding: 14px 16px 10px; }
        .token-monitor-settings__section--overview { grid-column: 1 / -1; }
        .token-monitor-settings__section { min-width: 0; }
        .token-monitor-settings__section h2 { color: #283868; }
        .token-monitor-settings__section h2::before { content: ""; display: inline-block; width: 5px; height: 18px; margin-right: 7px; vertical-align: -3px; border-radius: 5px; background: linear-gradient(#3858a8,#6f91dc); }
        .token-monitor-settings__section-title { display: flex; align-items: center; gap: 9px; min-height: 28px; margin-bottom: 7px; }
        .token-monitor-settings__overview-heading { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 7px; }
        .token-monitor-settings__overview-heading .token-monitor-settings__section-title { margin-bottom: 0; }
        .token-monitor-settings__overview { display: grid; grid-template-columns: repeat(3,minmax(0,1fr)); gap: 8px; }
        .token-monitor-settings__metric { min-width: 0; min-height: 68px; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 9px 12px; border: 1px solid rgba(56,88,168,.14); border-radius: 12px; background: rgba(255,255,255,.74); text-align: center; overflow: hidden; }
        .token-monitor-settings__metric span { display: block; width: 100%; color: #6874a8; font-size: 11px; text-align: center; }
        .token-monitor-settings__metric strong { display: block; width: 100%; margin-top: 4px; color: #3858a8; font-size: 14px; font-weight: 800; font-variant-numeric: tabular-nums; text-align: center; }
        .token-monitor-settings__fixed-note { margin: 9px 0 2px; padding: 8px 10px; border: 1px dashed #b8c8eb; border-radius: 10px; background: rgba(238,243,255,.86); color: #6874a8; font-size: 11px; line-height: 1.5; }
        .token-monitor-settings__left-stack { display: flex; min-width: 0; flex-direction: column; gap: 10px; }
        .token-monitor-settings__left-stack > .token-monitor-settings__section { width: 100%; }
        .token-monitor-settings__switch-field { display: flex; align-items: center; gap: 14px; min-height: 30px; padding: 3px 0; }
        .token-monitor-settings__switch-field--indent { padding-left: 14px; }
        .token-monitor-settings__subgroup { margin-top: 4px; padding-top: 4px; border-top: 1px dashed #cbd7ef; }
        .token-monitor-settings__budget { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 30px; padding: 3px 0 3px 14px; }
        .token-monitor-settings__budget-row { display: inline-flex; align-items: center; gap: 6px; flex: 0 0 auto; }
        .token-monitor-settings__budget-input { width: 76px; height: 22px; min-height: 22px; padding: 1px 7px; border: 1px solid #c6d4f2; border-radius: 7px; outline: none; background: #fff; color: #283868; font: 600 12px/18px ui-sans-serif,system-ui,sans-serif; font-variant-numeric: tabular-nums; text-align: right; }
        .token-monitor-settings__budget-input:focus { border-color: #3858a8; box-shadow: 0 0 0 3px rgba(56,88,168,.14); }
        .token-monitor-settings__wechat { width: 100%; min-width: 0; margin-top: 6px; padding: 8px; border: 1px solid rgba(56,88,168,.17); border-radius: 12px; background: rgba(245,247,255,.82); overflow: hidden; }
        .token-monitor-settings__wechat-status { display: flex; align-items: flex-start; gap: 10px; min-width: 0; }
        .token-monitor-settings__wechat-status-copy { flex: 1 1 auto; min-width: 0; overflow-wrap: anywhere; word-break: break-word; }
        .token-monitor-settings__wechat-status-copy > div { max-width: 100%; overflow-wrap: anywhere; word-break: break-word; }
        .token-monitor-settings__wechat-refresh { flex: 0 0 auto; }
        .token-monitor-settings__wechat-hint, .token-monitor-settings__wechat-message { max-width: 100%; overflow-wrap: anywhere; word-break: break-word; }
        .token-monitor-settings__section--notification { height: 100%; }
        .token-monitor-settings__qr-area { display: grid; place-items: center; width: min(148px,100%); aspect-ratio: 1; margin: 6px auto 0; padding: 6px; overflow: hidden; border: 1px dashed rgba(56,88,168,.38); border-radius: 12px; background: #fff; color: #6874a8; text-align: center; }
        .token-monitor-settings__qr-area > * { max-width: 100%; max-height: 100%; }
        .token-monitor-settings__qr-area img { display: block; width: 100%; height: 100%; padding: 0; border-radius: 7px; background: #fff; object-fit: contain; image-rendering: pixelated; }
        .token-monitor-settings__qr-meta { margin-top: 4px; text-align: center; }
        .token-monitor-settings__wechat-actions { display: grid; gap: 5px; margin-top: 6px; }
        .token-monitor-settings__wechat-actions-short { display: grid; grid-template-columns: repeat(2,minmax(0,92px)); justify-content: center; gap: 5px; }
        .token-monitor-settings__wechat-actions-long { display: grid; grid-template-columns: repeat(3,minmax(0,1fr)); gap: 5px; }
        .token-monitor-settings__disconnect-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
        .token-monitor-settings__disconnect-actions > button { flex: 1 1 112px; min-width: 0; }
        .token-monitor-settings__update-version { margin-top: 8px; color: #6874a8; font-size: 11px; }
        .token-monitor-settings__update-actions { display: grid; grid-template-columns: 36px minmax(94px,1fr) minmax(94px,1fr); align-items: center; gap: 7px; margin-top: 10px; }
        .token-monitor-settings__update-icon { display: grid; place-items: center; width: 36px; height: 34px; padding: 0; border: 1px solid rgba(56,88,168,.3); border-radius: 9px; background: #f5f7ff; color: #3858a8; text-decoration: none; cursor: pointer; }
        .token-monitor-settings__update-icon svg { width: 19px; height: 19px; fill: currentColor; }
        .token-monitor-settings__update-icon:hover { border-color: #3858a8; background: #eaf0ff; }
        .token-monitor-settings__update-icon:disabled { cursor: not-allowed; opacity: .5; }
        .token-monitor-settings__update-check, .token-monitor-settings__update-install { min-height: 34px; padding: 6px 10px; border: 1px solid rgba(56,88,168,.3); border-radius: 9px; font: inherit; white-space: nowrap; cursor: pointer; }
        .token-monitor-settings__update-check { background: #f5f7ff; color: #3858a8; }
        .token-monitor-settings__update-install { background: linear-gradient(135deg, #3858a8, #476fc4); color: #fff; }
        .token-monitor-settings__update-check:disabled,
        .token-monitor-settings__update-install:disabled { cursor: not-allowed; opacity: .45; }
        .token-monitor-settings button[role="switch"] { flex-basis: 46px; }
        .token-monitor-settings__footer { position: sticky; bottom: 0; z-index: 3; display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 9px; padding: 13px 20px 18px; border-top: 1px solid rgba(56,88,168,.10); background: linear-gradient(0deg,#f8faff 78%,rgba(248,250,255,.92)); }
        .token-monitor-settings__footer-message { flex: 1 1 180px; min-width: 0; overflow-wrap: anywhere; word-break: break-word; }
        .token-monitor-settings__footer > button { flex: 0 0 auto; }
        @media (max-width: 719px) { .token-monitor-settings { width: min(560px,calc(100vw - 24px)) !important; } .token-monitor-settings__grid { grid-template-columns: 1fr; } .token-monitor-settings__section--overview { grid-column: auto; } .token-monitor-settings__overview { grid-template-columns: 1fr; } .token-monitor-settings__wechat-actions-short, .token-monitor-settings__wechat-actions-long { grid-template-columns: 1fr; } .token-monitor-settings__wechat-refresh { min-width: 0; } .token-monitor-settings__update-actions { grid-template-columns: 36px minmax(0,1fr) minmax(0,1fr); } .token-monitor-settings__head-copy { padding-right: 64px; } .token-monitor-settings__ribbon { right: 46px; opacity: .55; } }
      `}</style>

      <header className="token-monitor-settings__head">
        <img className="token-monitor-settings__ribbon" src={cuteAsset('cute-decoration-ribbon')} alt="" />
        <div className="token-monitor-settings__head-copy">
          <h1 className="token-monitor-settings__title">详细设置</h1>
        </div>
        <button type="button" className="token-monitor-settings__close" aria-label="关闭监控设置" onClick={props.onClose}>
          <img src={cuteAsset('cute-icon-close')} alt="" />
        </button>
      </header>

      <div className="token-monitor-settings__grid">
        <section className="token-monitor-settings__section token-monitor-settings__section--overview" style={SECTION} aria-labelledby="overview-settings-title">
          <div className="token-monitor-settings__overview-heading">
            <div id="overview-settings-title"><SectionTitle iconName="cute-icon-account-balance" title="概览" /></div>
            <SummaryRangeSelector value={summaryRange} onChange={setSummaryRange} />
          </div>
          <div className="token-monitor-settings__overview">
            <div className="token-monitor-settings__metric" title={usageSummary === undefined ? undefined : metricTitle(usageSummary.spendCny, '¥')}><span>消费</span><strong>{usageSummary === undefined ? (usageSummaryLoading ? '…' : '¥0.00') : `¥${formatChineseCompactCurrency(usageSummary.spendCny)}`}</strong></div>
            <div className="token-monitor-settings__metric" title={usageSummary === undefined ? undefined : metricTitle(usageSummary.requestCount)}><span>请求数</span><strong>{formatChineseCompactNumber(usageSummary?.requestCount ?? 0)}</strong></div>
            <div className="token-monitor-settings__metric" title={usageSummary === undefined ? undefined : metricTitle(usageSummary.totalTokens)}><span>Token 总数</span><strong>{formatChineseCompactNumber(usageSummary?.totalTokens ?? 0)}</strong></div>
            <div className="token-monitor-settings__metric" title={usageSummary === undefined ? undefined : metricTitle(usageSummary.cacheHitTokens)}><span>缓存命中 Token</span><strong>{formatChineseCompactNumber(usageSummary?.cacheHitTokens ?? 0)}</strong></div>
            <div className="token-monitor-settings__metric" title={usageSummary === undefined ? undefined : metricTitle(usageSummary.cacheHitRate * 100, '', '%')}><span>缓存命中率</span><strong>{usageSummary === undefined ? '0%' : `${(usageSummary.cacheHitRate * 100).toFixed(1)}%`}</strong></div>
            <div className="token-monitor-settings__metric" title={usageSummary === undefined ? undefined : metricTitle(usageSummary.activeDays)}><span>活跃天数</span><strong>{formatChineseCompactNumber(usageSummary?.activeDays ?? 0)}</strong></div>
          </div>
        </section>

        <div className="token-monitor-settings__left-stack">
        <section className="token-monitor-settings__section" style={SECTION} aria-labelledby="rules-settings-title">
          <div id="rules-settings-title"><SectionTitle iconName="cute-icon-warning" title="提醒规则" /></div>
          <SwitchField id="daily-budget-enabled" label="启用今日预算" checked={draft.dailyBudgetEnabled} onChange={(value) => { updateDraft('dailyBudgetEnabled', value) }} />
          <label htmlFor="daily-budget-cny" className="token-monitor-settings__budget" style={{ opacity: draft.dailyBudgetEnabled ? 1 : 0.58 }}>
            <span style={{ display: 'block', fontSize: 14, fontWeight: 650 }}>预算阈值</span>
            <span className="token-monitor-settings__budget-row">
              <span aria-hidden="true" style={{ color: '#6874a8' }}>¥</span>
              <input
                id="daily-budget-cny"
                className="token-monitor-settings__budget-input"
                inputMode="decimal"
                value={budgetInput}
                disabled={!draft.dailyBudgetEnabled}
                onChange={(event) => { setBudgetInput(event.currentTarget.value); setSaveState('idle'); setSaveError(undefined) }}
              />
            </span>
          </label>
          <SwitchField id="budget-exceeded-notification-enabled" label="超过预算时提醒" checked={draft.budgetExceededNotificationEnabled} disabled={!draft.dailyBudgetEnabled} indent onChange={(value) => { updateDraft('budgetExceededNotificationEnabled', value) }} />
          <div className="token-monitor-settings__subgroup">
            <SwitchField id="peak-reminder-enabled" label="峰谷提醒总开关" checked={draft.peakReminderEnabled} onChange={(value) => { updateDraft('peakReminderEnabled', value) }} />
            <SwitchField id="peak-reminder-enter-peak" label="进入峰时段" checked={draft.peakReminderEnterPeak} disabled={!draft.peakReminderEnabled} indent onChange={(value) => { updateDraft('peakReminderEnterPeak', value) }} />
            <SwitchField id="peak-reminder-enter-valley" label="进入谷时段" checked={draft.peakReminderEnterValley} disabled={!draft.peakReminderEnabled} indent onChange={(value) => { updateDraft('peakReminderEnterValley', value) }} />
          </div>
          <div className="token-monitor-settings__subgroup">
            <SwitchField id="cache-hit-anomaly-enabled" label="缓存命中异常提醒" checked={draft.cacheHitAnomalyNotificationEnabled} onChange={(value) => { updateDraft('cacheHitAnomalyNotificationEnabled', value) }} />
            <label htmlFor="cache-hit-anomaly-threshold" className="token-monitor-settings__budget" style={{ opacity: draft.cacheHitAnomalyNotificationEnabled ? 1 : 0.58 }}>
              <span style={{ display: 'block', fontSize: 14, fontWeight: 650 }}>缓存命中率阈值</span>
              <span className="token-monitor-settings__budget-row"><input id="cache-hit-anomaly-threshold" className="token-monitor-settings__budget-input" inputMode="numeric" value={cacheThresholdInput} onChange={(event) => { setCacheThresholdInput(event.currentTarget.value); setSaveState('idle') }} /><span>%</span></span>
            </label>
            <label htmlFor="cache-hit-anomaly-consecutive" className="token-monitor-settings__budget" style={{ opacity: draft.cacheHitAnomalyNotificationEnabled ? 1 : 0.58 }}>
              <span style={{ display: 'block', fontSize: 14, fontWeight: 650 }}>连续低于次数</span>
              <span className="token-monitor-settings__budget-row"><input id="cache-hit-anomaly-consecutive" className="token-monitor-settings__budget-input" inputMode="numeric" value={cacheCallsInput} onChange={(event) => { setCacheCallsInput(event.currentTarget.value); setSaveState('idle') }} /><span>次</span></span>
            </label>
          </div>
        </section>

        <section className="token-monitor-settings__section token-monitor-settings__section--updates" style={SECTION} aria-labelledby="update-settings-title">
          <div id="update-settings-title"><SectionTitle iconName="cute-icon-settings" title="插件更新" /></div>
          <div className="token-monitor-settings__update-version">当前版本 v{updateStatus?.currentVersion ?? '4.0.4'}</div>
          <div className="token-monitor-settings__update-actions">
            <a className="token-monitor-settings__update-icon" href="https://github.com/wssfk12138/dsh-damage-pulse" target="_blank" rel="noreferrer" role="button" aria-label="打开 GitHub 项目主页" title="打开 GitHub 项目主页"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 0C3.58 0 0 3.64 0 8.13c0 3.59 2.29 6.64 5.47 7.72.4.08.55-.18.55-.39 0-.19-.01-.83-.01-1.5-2.01.38-2.53-.5-2.69-.96-.09-.23-.48-.96-.82-1.15-.28-.15-.68-.54-.01-.55.63-.01 1.08.59 1.23.83.72 1.23 1.87.88 2.33.67.07-.53.28-.88.51-1.08-1.78-.21-3.64-.9-3.64-4.01 0-.89.31-1.62.82-2.19-.08-.2-.36-1.04.08-2.16 0 0 .67-.22 2.2.84A7.48 7.48 0 0 1 8 3.89c.68 0 1.36.09 2 .27 1.53-1.06 2.2-.84 2.2-.84.44 1.12.16 1.96.08 2.16.51.57.82 1.3.82 2.19 0 3.12-1.87 3.8-3.65 4.01.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.47.55.39A8.04 8.04 0 0 0 16 8.13C16 3.64 12.42 0 8 0Z" /></svg></a>
            <button className="token-monitor-settings__update-check" type="button" disabled={updateAction !== undefined} onClick={() => { void checkForUpdates() }}>{updateAction === 'check' ? '检查中…' : '检查更新'}</button>
            <button className="token-monitor-settings__update-install" type="button" disabled={updateAction !== undefined || updateStatus?.hasUpdate !== true} onClick={() => { void installUpdate() }}>{updateAction === 'install' ? '安装中…' : '安装更新'}</button>
          </div>
          {updateStatus !== undefined && <p style={{ ...descriptionStyle(), marginBottom: 0 }}>最新 v{updateStatus.latestVersion}{updateStatus.asset === null ? ' · 暂无可用安装包' : ''}</p>}
          {updateMessage !== undefined && <p aria-live="polite" style={{ ...descriptionStyle(), marginBottom: 0, color: '#3f8f6a' }}>{updateMessage}</p>}
          {updateError !== undefined && <p role="alert" style={{ ...descriptionStyle(), marginBottom: 0, color: '#bd3e5a' }}>{updateError}</p>}
        </section>
        </div>

        <section className="token-monitor-settings__section token-monitor-settings__section--notification" style={SECTION} aria-labelledby="notification-settings-title">
          <div id="notification-settings-title"><SectionTitle iconName="cute-icon-notification" title="通知渠道" /></div>
          <SwitchField id="whale-bubble-enabled" label="鲸鱼娘通知气泡" checked={draft.whaleBubbleEnabled} onChange={(value) => { updateDraft('whaleBubbleEnabled', value) }} />
          <SwitchField id="wechat-notifications-enabled" label="微信通知" checked={draft.wechatNotificationsEnabled} onChange={(value) => { updateDraft('wechatNotificationsEnabled', value) }} />

          <div className="token-monitor-settings__wechat">
            <div aria-live="polite" className="token-monitor-settings__wechat-status">
              <span aria-hidden="true" style={{ width: 9, height: 9, marginTop: 5, borderRadius: '50%', background: status?.auth === 'authenticated' ? '#46a878' : '#9eb2df', boxShadow: '0 0 0 4px rgba(56,88,168,.10)' }} />
              <div className="token-monitor-settings__wechat-status-copy">
                <div style={{ color: '#283868', fontSize: 13, fontWeight: 700 }}>{connectionSummary(status)}</div>
                {status?.identity !== undefined && <div style={descriptionStyle()}>账号 {status.identity.maskedUserId}</div>}
                {deliverySummary(status) !== undefined && <div style={descriptionStyle()}>{deliverySummary(status)}</div>}
                {status?.lastError !== undefined && <div style={{ ...descriptionStyle(), color: '#bd3e5a' }}>{status.lastError.message}</div>}
                {statusError !== undefined && <div role="alert" style={{ ...descriptionStyle(), color: '#bd3e5a' }}>{statusError}</div>}
              </div>
              <button className="token-monitor-settings__wechat-refresh" type="button" disabled={action !== undefined} onClick={() => { void refreshStatus() }} style={actionButtonStyle(action !== undefined)}>刷新</button>
            </div>

            {ownershipHint !== undefined && <p className="token-monitor-settings__wechat-hint" data-wechat-ownership-hint="" style={{ margin: '10px 0 0', padding: '9px 11px', borderRadius: 10, background: 'rgba(230,167,81,.11)', color: '#6874a8', fontSize: 12, lineHeight: 1.5 }}>{ownershipHint}</p>}

            <div className="token-monitor-settings__qr-area" data-wechat-qr-area="">
              {loginSession === undefined
                ? <span>登录微信后，二维码显示在此处</span>
                : props.renderLoginQr === undefined
                  ? <LocalLoginQr payload={loginSession.qrPayload} />
                  : props.renderLoginQr(loginSession.qrPayload)}
            </div>
            {loginSession !== undefined && (
              <div className="token-monitor-settings__qr-meta">
                <div style={descriptionStyle()}>二维码约 {String(secondsRemaining ?? 0)} 秒后失效。</div>
                <details style={{ marginTop: 5, textAlign: 'left' }}>
                  <summary style={{ cursor: 'pointer', color: '#6874a8', fontSize: 12 }}>二维码无法加载？打开登录链接</summary>
                  <a href={loginSession.qrPayload} target="_blank" rel="noreferrer" data-wechat-qr-link="" style={{ display: 'block', marginTop: 6, color: '#3858a8', fontSize: 11, overflowWrap: 'anywhere' }}>{loginSession.qrPayload}</a>
                </details>
              </div>
            )}

            {loginSession === undefined && status?.pendingLogin !== undefined && <p style={{ ...descriptionStyle(), margin: '10px 0 0' }}>Host 中仍有短时登录会话；二维码不会跨面板恢复，可确认状态或重新获取。</p>}

            <div className="token-monitor-settings__wechat-actions">
              <div className="token-monitor-settings__wechat-actions-short">
                <button type="button" disabled={!canReconnect} onClick={() => { void reconnect() }} style={actionButtonStyle(!canReconnect)}>{action === 'reconnect' ? '正在重连…' : '重连'}</button>
                <button type="button" disabled={!canDisconnect} onClick={() => { setDisconnectConfirmation(true) }} style={actionButtonStyle(!canDisconnect, true)}>断开</button>
              </div>
              <div className="token-monitor-settings__wechat-actions-long">
                <button type="button" disabled={!canLogin} onClick={() => { void startLogin() }} style={actionButtonStyle(!canLogin)}>{action === 'login' ? '正在获取…' : '登录微信'}</button>
                <button type="button" disabled={!canConfirm} onClick={() => { void confirmLogin() }} style={actionButtonStyle(!canConfirm)}>{action === 'confirm' ? '正在确认…' : '确认登录状态'}</button>
                <button type="button" disabled={!canTestMessage} onClick={() => { void testMessage() }} style={actionButtonStyle(!canTestMessage)}>{action === 'test' ? '正在发送…' : '发送测试消息'}</button>
              </div>
            </div>

            {disconnectConfirmation && (
              <div role="alertdialog" aria-label="确认断开微信连接" style={{ marginTop: 12, padding: 12, border: '1px solid rgba(204,72,99,.30)', borderRadius: 12, background: 'rgba(204,72,99,.07)' }}>
                <div style={{ fontSize: 13, fontWeight: 750 }}>确定断开 DSH Host 管理的微信 bridge？</div>
                <div style={descriptionStyle()}>只会操作 Host-owned 进程；外部 bridge 不会被结束。</div>
                <div className="token-monitor-settings__disconnect-actions">
                  <button type="button" disabled={action !== undefined} onClick={() => { setDisconnectConfirmation(false) }} style={actionButtonStyle(action !== undefined)}>取消</button>
                  <button type="button" disabled={!canDisconnect} onClick={() => { void disconnect() }} style={{ ...actionButtonStyle(!canDisconnect, true), background: '#c94b68', color: '#fff', borderColor: 'transparent' }}>{action === 'disconnect' ? '正在断开…' : '确认断开'}</button>
                </div>
              </div>
            )}

            {actionMessage !== undefined && <p className="token-monitor-settings__wechat-message" aria-live="polite" style={{ ...descriptionStyle(), marginBottom: 0, color: '#3f8f6a' }}>{actionMessage}</p>}
            {actionError !== undefined && <p className="token-monitor-settings__wechat-message" role="alert" style={{ ...descriptionStyle(), marginBottom: 0, color: '#bd3e5a' }}>{actionError}</p>}
          </div>
        </section>

      </div>

      <footer className="token-monitor-settings__footer">
        <span className="token-monitor-settings__footer-message" aria-live="polite" style={{ color: saveError === undefined ? '#3f8f6a' : '#bd3e5a', fontSize: 12 }}>{saveError ?? (saveState === 'saved' ? '设置已保存。' : '')}</span>
        <button type="button" onClick={props.onClose} style={BUTTON}>关闭</button>
        <button type="submit" disabled={saveState === 'saving'} style={{ ...PRIMARY_BUTTON, opacity: saveState === 'saving' ? 0.62 : 1, cursor: saveState === 'saving' ? 'wait' : 'pointer' }}>{saveState === 'saving' ? '保存中…' : '保存设置'}</button>
      </footer>
    </form>
  )
}
