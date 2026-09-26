import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'
import {
  TOKEN_MONITOR_MAX_DAILY_BUDGET_CNY,
  type TokenMonitorSettings,
  type TokenMonitorSettingsPatch,
  type TokenMonitorSettingsPatchRequest,
  type TokenMonitorSettingsSnapshot,
} from '@deepseek-ai/dsh-token-monitor-contract'
import { PRODUCT_NAME } from './branding.ts'
import {
  WechatConnectionApiError,
  type WechatConnectionApi,
  type WechatLoginConfirmation,
  type WechatRuntimeStatus,
} from './wechatConnectionApi.ts'
const LocalLoginQr = lazy(() => import('./WechatLoginQr.tsx').then(module => ({ default: module.WechatLoginQr })))

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

/** 三个数字输入共用一套校验；失焦或回车时才提交，避免每敲一个字符写一次设置。 */
type NumberInputId = 'daily-budget-cny' | 'cache-hit-anomaly-threshold' | 'cache-hit-anomaly-consecutive'

const NUMBER_INPUT_IDS: readonly NumberInputId[] = ['daily-budget-cny', 'cache-hit-anomaly-threshold', 'cache-hit-anomaly-consecutive']

const NUMBER_FIELD_KEYS: Record<NumberInputId, 'dailyBudgetCny' | 'cacheHitAnomalyThreshold' | 'cacheHitAnomalyConsecutiveCalls'> = {
  'daily-budget-cny': 'dailyBudgetCny',
  'cache-hit-anomaly-threshold': 'cacheHitAnomalyThreshold',
  'cache-hit-anomaly-consecutive': 'cacheHitAnomalyConsecutiveCalls',
}

function parseNumberInput(id: NumberInputId, raw: string): number | undefined {
  const text = raw.trim()
  if (text === '') return undefined
  const value = Number(text)
  if (!Number.isFinite(value)) return undefined
  if (id === 'daily-budget-cny') {
    if (!(value > 0 && value <= TOKEN_MONITOR_MAX_DAILY_BUDGET_CNY)) return undefined
    return Math.abs(value * 100 - Math.round(value * 100)) <= 1e-9 ? value : undefined
  }
  if (!Number.isInteger(value)) return undefined
  if (id === 'cache-hit-anomaly-threshold') return value >= 0 && value <= 100 ? value : undefined
  return value >= 2 && value <= 20 ? value : undefined
}

function numberInputError(id: NumberInputId): string {
  if (id === 'daily-budget-cny') return `每日预算必须大于 0、不超过 ${String(TOKEN_MONITOR_MAX_DAILY_BUDGET_CNY)}，且最多两位小数；这项改动没有保存。`
  if (id === 'cache-hit-anomaly-threshold') return '缓存命中率阈值必须是 0 到 100 的整数；这项改动没有保存。'
  return '连续低于次数必须是 2 到 20 的整数；这项改动没有保存。'
}

interface LoginSession {
  sessionId: string
  expiresAt: number
  qrPayload: string
}

export interface TokenMonitorSettingsPanelProps {
  snapshot: TokenMonitorSettingsSnapshot
  title: string
  wechatInstalled?: boolean
  petInstalled?: boolean
  providers?: readonly string[]
  loadProvider?(provider: string): Promise<TokenMonitorSettingsSnapshot>
  saveProvider?(provider: string, request: TokenMonitorSettingsPatchRequest): Promise<TokenMonitorSettingsSnapshot>
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
  border: '1px solid var(--dsw-alias-monitor-border)',
  borderRadius: 23,
  background: 'var(--dsw-alias-monitor-panel)',
  color: 'var(--dsw-alias-monitor-label)',
  boxShadow: 'var(--dsw-alias-monitor-panel-shadow)',
  fontFamily: 'var(--dsh-font-family, ui-sans-serif, system-ui, sans-serif)',
}

const SECTION: CSSProperties = {
  minWidth: 0,
  margin: 0,
  padding: 14,
  border: '1px solid var(--dsw-alias-monitor-card-border)',
  borderRadius: 16,
  background: 'var(--dsw-alias-monitor-card)',
  boxShadow: 'var(--dsw-alias-monitor-card-shadow)',
}

const BUTTON: CSSProperties = {
  minHeight: 36,
  padding: '7px 13px',
  border: '1px solid var(--dsw-alias-monitor-button-border)',
  borderRadius: 10,
  background: 'var(--dsw-alias-monitor-button)',
  color: 'var(--dsw-alias-monitor-label)',
  cursor: 'pointer',
  font: 'inherit',
  fontSize: 13,
  fontWeight: 650,
}

function descriptionStyle(disabled = false): CSSProperties {
  return { marginTop: 3, color: 'var(--dsw-alias-monitor-muted)', fontSize: 12, lineHeight: 1.45, opacity: disabled ? 0.62 : 1 }
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
          border: '1px solid var(--dsw-alias-monitor-switch-border)',
          borderRadius: 999,
          background: checked ? 'var(--dsw-alias-monitor-accent-gradient)' : 'var(--dsw-alias-monitor-switch-off)',
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
            background: 'var(--dsw-alias-monitor-thumb)',
            boxShadow: 'var(--dsw-alias-monitor-thumb-shadow)',
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

function actionButtonStyle(disabled: boolean, dangerous = false): CSSProperties {
  return {
    ...BUTTON,
    ...(dangerous ? { borderColor: 'var(--dsw-alias-monitor-danger-border)', color: 'var(--dsw-alias-monitor-error)' } : {}),
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.5 : 1,
  }
}

export function TokenMonitorSettingsPanel(props: TokenMonitorSettingsPanelProps): ReactNode {
  const { snapshot } = props
  const wechatInstalled = props.wechatInstalled !== false
  const [provider, setProvider] = useState('deepseek-official')
  const [switchingProvider, setSwitchingProvider] = useState(false)
  const providerRef = useRef(provider)
  const [draft, setDraft] = useState<TokenMonitorSettings>(() => ({ ...snapshot.settings }))
  const [numberInputs, setNumberInputs] = useState<Record<NumberInputId, string>>(() => ({
    'daily-budget-cny': String(snapshot.settings.dailyBudgetCny),
    'cache-hit-anomaly-threshold': String(snapshot.settings.cacheHitAnomalyThreshold),
    'cache-hit-anomaly-consecutive': String(snapshot.settings.cacheHitAnomalyConsecutiveCalls),
  }))
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [saveError, setSaveError] = useState<string>()
  const [status, setStatus] = useState<WechatRuntimeStatus>()
  const [statusError, setStatusError] = useState<string>()
  const [action, setAction] = useState<'login' | 'confirm' | 'reconnect' | 'disconnect' | 'test'>()
  const [actionMessage, setActionMessage] = useState<string>()
  const [actionError, setActionError] = useState<string>()
  const [loginSession, setLoginSession] = useState<LoginSession>()
  const [disconnectConfirmation, setDisconnectConfirmation] = useState(false)
  const [clock, setClock] = useState(() => Date.now())
  const mounted = useRef(true)
  const statusController = useRef<AbortController>()
  const actionController = useRef<AbortController>()
  const draftRef = useRef<TokenMonitorSettings>(draft)
  const numberInputsRef = useRef(numberInputs)
  const focusedInputRef = useRef<NumberInputId>()
  // 服务器已确认的设置与版本号；自动保存的 patch 和 expectedRevision 都以此为准。
  const serverRef = useRef<{ revision: number; settings: TokenMonitorSettings }>(
    { revision: snapshot.revision, settings: { ...snapshot.settings } },
  )
  const savingRef = useRef(false)
  const savePromiseRef = useRef<Promise<void>>()
  const switchingRef = useRef(false)
  const pendingRef = useRef(false)

  const setNumberInput = (id: NumberInputId, raw: string) => {
    numberInputsRef.current = { ...numberInputsRef.current, [id]: raw }
    setNumberInputs(numberInputsRef.current)
  }

  /** 用服务器返回值刷新界面；用户正在输入的数字框默认不被覆盖。 */
  const adoptServerSettings = useCallback((settings: TokenMonitorSettings, force = false) => {
    draftRef.current = { ...settings }
    setDraft({ ...settings })
    const next = { ...numberInputsRef.current }
    for (const id of NUMBER_INPUT_IDS) {
      if (!force && focusedInputRef.current === id) continue
      next[id] = String(settings[NUMBER_FIELD_KEYS[id]])
    }
    numberInputsRef.current = next
    setNumberInputs(next)
  }, [])

  /**
   * 把草稿里尚未落盘的改动提交给 Host。多次快速改动会合并成串行保存，
   * 每次都带上一次返回的 revision，因此不会出现并发写入或版本冲突。
   */
  const flushSaves = useCallback((): Promise<void> => {
    if (savePromiseRef.current) return savePromiseRef.current
    const operation = (async () => {
      savingRef.current = true
      let failed = false
      try {
        while (pendingRef.current) {
          pendingRef.current = false
          const patch: TokenMonitorSettingsPatch = {}
          for (const key of SETTINGS_KEYS) {
            if (draftRef.current[key] !== serverRef.current.settings[key]) {
              ;(patch as Record<EditableSettingsKey, TokenMonitorSettings[EditableSettingsKey]>)[key] = draftRef.current[key]
            }
          }
          if (Object.keys(patch).length === 0) continue
          setSaveState('saving')
          try {
            const request = { expectedRevision: serverRef.current.revision, patch }
            const nextSnapshot = await (props.saveProvider?.(providerRef.current, request) ?? props.onSave(request))
            serverRef.current = { revision: nextSnapshot.revision, settings: { ...nextSnapshot.settings } }
            if (!mounted.current) return
            setSaveError(undefined)
            setSaveState('saved')
            if (!pendingRef.current) adoptServerSettings(nextSnapshot.settings)
          } catch (error) {
            failed = true
            if (mounted.current) {
              setSaveState('idle')
              setSaveError(error instanceof Error ? error.message : '设置保存失败，请稍后重试。')
            }
            break
          }
        }
      } finally {
        savingRef.current = false
      }
      // Failed edits stay visible; switching providers is blocked until they are saved.
      if (failed) pendingRef.current = true
    })()
    savePromiseRef.current = operation
    void operation.finally(() => { savePromiseRef.current = undefined })
    return operation
  }, [adoptServerSettings, props.onSave, props.saveProvider])

  /** 取输入框里校验通过的数字；未通过校验的字段沿用上一次有效值。 */
  const withValidNumbers = (base: TokenMonitorSettings): TokenMonitorSettings => {
    const next = { ...base }
    const budget = parseNumberInput('daily-budget-cny', numberInputsRef.current['daily-budget-cny'])
    if (budget !== undefined) next.dailyBudgetCny = budget
    const threshold = parseNumberInput('cache-hit-anomaly-threshold', numberInputsRef.current['cache-hit-anomaly-threshold'])
    if (threshold !== undefined) next.cacheHitAnomalyThreshold = threshold
    const calls = parseNumberInput('cache-hit-anomaly-consecutive', numberInputsRef.current['cache-hit-anomaly-consecutive'])
    if (calls !== undefined) next.cacheHitAnomalyConsecutiveCalls = calls
    return next
  }

  const persistDraft = (nextDraft: TokenMonitorSettings, options?: { keepError?: boolean }) => {
    draftRef.current = nextDraft
    setDraft(nextDraft)
    if (options?.keepError !== true) setSaveError(undefined)
    pendingRef.current = true
    void flushSaves()
  }

  /** 开关改动立即保存。 */
  const applySwitch = <K extends EditableSettingsKey>(key: K, value: TokenMonitorSettings[K]) => {
    if (switchingRef.current) return
    persistDraft(withValidNumbers({ ...draftRef.current, [key]: value }))
  }

  /** 数字输入在失焦或回车时校验并保存；无效值只提示、不写入。 */
  const commitNumberInputs = () => {
    const base = draftRef.current
    const next = withValidNumbers(base)
    let error: string | undefined
    for (const id of NUMBER_INPUT_IDS) {
      if (parseNumberInput(id, numberInputsRef.current[id]) !== undefined) continue
      if (numberInputsRef.current[id].trim() === String(base[NUMBER_FIELD_KEYS[id]])) continue
      error = error ?? numberInputError(id)
    }
    if (SETTINGS_KEYS.some(key => next[key] !== base[key])) {
      persistDraft(next, { keepError: true })
    } else {
      setSaveState('idle')
    }
    if (error !== undefined) setSaveError(error)
    return error === undefined
  }

  const requestClose = async () => {
    // 关闭前提交尚未失焦的数字输入，避免最后一次改动丢失。
    if (switchingRef.current || !commitNumberInputs()) return
    await flushSaves()
    if (!pendingRef.current) props.onClose()
  }

  const selectProvider = async (nextProvider: string) => {
    if (!props.loadProvider || switchingRef.current || !commitNumberInputs()) return
    switchingRef.current = true
    setSwitchingProvider(true)
    try {
      await flushSaves()
      if (pendingRef.current || !mounted.current) return
      const next = await props.loadProvider(nextProvider)
      if (!mounted.current) return
      providerRef.current = nextProvider
      setProvider(nextProvider)
      serverRef.current = { revision: next.revision, settings: { ...next.settings } }
      adoptServerSettings(next.settings, true)
      setSaveError(undefined)
      setSaveState('idle')
    } catch (error) {
      if (mounted.current) setSaveError(errorMessage(error))
    } finally { switchingRef.current = false; if (mounted.current) setSwitchingProvider(false) }
  }

  useEffect(() => {
    if (providerRef.current !== 'deepseek-official' || switchingRef.current) return
    // 忽略比已确认版本更旧的快照：界面刷新请求可能与自动保存交错返回。
    if (snapshot.revision < serverRef.current.revision) return
    serverRef.current = { revision: snapshot.revision, settings: { ...snapshot.settings } }
    // 自动保存的响应本身也会带来新快照；本地仍有未落盘改动时保持用户输入不被覆盖。
    if (savingRef.current || pendingRef.current) return
    adoptServerSettings(snapshot.settings)
  }, [snapshot, adoptServerSettings])

  useEffect(() => {
    mounted.current = true
    if (!wechatInstalled) {
      setLoginSession(undefined); setDisconnectConfirmation(false); setStatus(undefined)
      return () => { mounted.current = false; actionController.current?.abort() }
    }
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
  }, [props.wechatApi, wechatInstalled])

  useEffect(() => {
    if (!wechatInstalled) return
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
  }, [loginSession, status?.pendingLogin?.expiresAt, wechatInstalled])

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
      aria-label={PRODUCT_NAME + ' 设置'}
      className="token-monitor-settings"
      data-token-monitor-settings-theme="whale-outfit-blue"
      // 自动保存：表单不再提供提交按钮，回车只用于提交数字输入。
      onSubmit={(event) => { event.preventDefault(); commitNumberInputs() }}
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
        if (event.key === 'Escape' && !disconnectConfirmation) requestClose()
      }}
      style={PANEL}
    >
      <style>{`
        .token-monitor-settings { color-scheme: var(--dsw-alias-detail-color-scheme); scrollbar-color: var(--dsw-alias-monitor-scrollbar) transparent; }
        .token-monitor-settings * { box-sizing: border-box; }
        .token-monitor-settings__head { position: sticky; top: 0; z-index: 3; display: flex; align-items: flex-start; justify-content: space-between; padding: 20px 22px 14px; border-bottom: 1px solid var(--dsw-alias-monitor-head-border); background: var(--dsw-alias-monitor-head); overflow: hidden; }
        .token-monitor-settings__head-copy { position: relative; z-index: 1; padding-right: 82px; }
        .token-monitor-settings__ribbon { position: absolute; z-index: 1; top: 2px; right: 52px; width: 62px; height: 62px; object-fit: contain; opacity: .82; pointer-events: auto; }
        .token-monitor-settings__kicker { color: var(--dsw-alias-monitor-brand); font-size: 10px; font-weight: 800; letter-spacing: .12em; }
        .token-monitor-settings__title { margin: 4px 0 0; color: var(--dsw-alias-monitor-label); font-size: 22px; line-height: 1.3; }
        .token-monitor-settings__close { position: relative; z-index: 2; display: grid; place-items: center; width: 34px; height: 34px; padding: 5px; border: 1px solid var(--dsw-alias-monitor-border); border-radius: 12px; background: var(--dsw-alias-monitor-close); cursor: pointer; }
        .token-monitor-settings__close:hover { border-color: var(--dsw-alias-monitor-focus); background: var(--dsw-alias-monitor-input); }
        .token-monitor-settings__close img { width: 100%; height: 100%; object-fit: contain; }
        .token-monitor-settings__grid { display: grid; grid-template-columns: minmax(300px,.88fr) minmax(0,1.12fr); align-items: stretch; gap: 10px; padding: 14px 16px 10px; }
        .token-monitor-settings__section { min-width: 0; }
        .token-monitor-settings__section h2 { color: var(--dsw-alias-monitor-label); }
        .token-monitor-settings__section h2::before { content: ""; display: inline-block; width: 5px; height: 18px; margin-right: 7px; vertical-align: -3px; border-radius: 5px; background: var(--dsw-alias-monitor-heading-gradient); }
        .token-monitor-settings__section-title { display: flex; align-items: center; gap: 9px; min-height: 28px; margin-bottom: 7px; }
        .token-monitor-settings__fixed-note { margin: 9px 0 2px; padding: 8px 10px; border: 1px dashed var(--dsw-alias-monitor-note-border); border-radius: 10px; background: var(--dsw-alias-monitor-note); color: var(--dsw-alias-monitor-muted); font-size: 11px; line-height: 1.5; }
        .token-monitor-settings__left-stack { display: flex; min-width: 0; flex-direction: column; gap: 10px; }
        .token-monitor-settings__left-stack > .token-monitor-settings__section { width: 100%; height: 100%; display: flex; flex-direction: column; justify-content: space-between; gap: 7px; }
        .token-monitor-settings__left-stack .token-monitor-settings__switch-field, .token-monitor-settings__left-stack .token-monitor-settings__budget { min-height: 38px; }
        .token-monitor-settings__switch-field { display: flex; align-items: center; gap: 14px; min-height: 30px; padding: 3px 0; }
        .token-monitor-settings__switch-field--indent { padding-left: 14px; }
        .token-monitor-settings__subgroup { margin-top: 4px; padding-top: 4px; border-top: 1px dashed var(--dsw-alias-monitor-separator); }
        .token-monitor-settings__budget { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 30px; padding: 3px 0 3px 14px; }
        .token-monitor-settings__budget-row { display: inline-flex; align-items: center; gap: 6px; flex: 0 0 auto; }
        .token-monitor-settings__budget-input { width: 76px; height: 22px; min-height: 22px; padding: 1px 7px; border: 1px solid var(--dsw-alias-monitor-border); border-radius: 7px; outline: none; background: var(--dsw-alias-monitor-input); color: var(--dsw-alias-monitor-label); font: 600 12px/18px ui-sans-serif,system-ui,sans-serif; font-variant-numeric: tabular-nums; text-align: right; }
        .token-monitor-settings__budget-input:focus { border-color: var(--dsw-alias-monitor-brand); box-shadow: 0 0 0 3px var(--dsw-alias-monitor-focus-ring); }
        .token-monitor-settings__wechat { width: 100%; min-width: 0; margin-top: 6px; padding: 8px; border: 1px solid var(--dsw-alias-monitor-wechat-border); border-radius: 12px; background: var(--dsw-alias-monitor-wechat); overflow: hidden; }
        .token-monitor-settings__wechat-status { display: flex; align-items: flex-start; gap: 10px; min-width: 0; }
        .token-monitor-settings__wechat-status-copy { flex: 1 1 auto; min-width: 0; overflow-wrap: anywhere; word-break: break-word; }
        .token-monitor-settings__wechat-status-copy > div { max-width: 100%; overflow-wrap: anywhere; word-break: break-word; }
        .token-monitor-settings__wechat-refresh { flex: 0 0 auto; }
        .token-monitor-settings__wechat-hint, .token-monitor-settings__wechat-message { max-width: 100%; overflow-wrap: anywhere; word-break: break-word; }
        .token-monitor-settings__section--notification { height: 100%; }
        .token-monitor-settings__qr-area { display: grid; place-items: center; width: min(148px,100%); aspect-ratio: 1; margin: 6px auto 0; padding: 6px; overflow: hidden; border: 1px dashed var(--dsw-alias-monitor-qr-border); border-radius: 12px; background: var(--dsw-alias-monitor-input); color: var(--dsw-alias-monitor-muted); text-align: center; }
        .token-monitor-settings__qr-area > * { max-width: 100%; max-height: 100%; }
        .token-monitor-settings__qr-area img { display: block; width: 100%; height: 100%; padding: 0; border-radius: 7px; background: var(--dsw-alias-monitor-qr-paper); object-fit: contain; image-rendering: pixelated; }
        .token-monitor-settings__qr-meta { margin-top: 4px; text-align: center; }
        .token-monitor-settings__wechat-actions { display: grid; gap: 5px; margin-top: 6px; }
        .token-monitor-settings__wechat-actions-short { display: grid; grid-template-columns: repeat(2,minmax(0,92px)); justify-content: center; gap: 5px; }
        .token-monitor-settings__wechat-actions-long { display: grid; grid-template-columns: repeat(3,minmax(0,1fr)); gap: 5px; }
        .token-monitor-settings__disconnect-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
        .token-monitor-settings__disconnect-actions > button { flex: 1 1 112px; min-width: 0; }
        .token-monitor-settings button[role="switch"] { flex-basis: 46px; }
        .token-monitor-settings__footer { position: sticky; bottom: 0; z-index: 3; display: flex; align-items: center; gap: 9px; padding: 9px 20px 11px; border-top: 1px solid var(--dsw-alias-monitor-soft-border); background: var(--dsw-alias-monitor-footer); }
        .token-monitor-settings__footer-message { flex: 1 1 auto; min-width: 0; overflow-wrap: anywhere; word-break: break-word; }
        @media (max-width: 719px) { .token-monitor-settings { width: min(560px,calc(100vw - 24px)) !important; } .token-monitor-settings__grid { grid-template-columns: 1fr; } .token-monitor-settings__wechat-actions-short, .token-monitor-settings__wechat-actions-long { grid-template-columns: 1fr; } .token-monitor-settings__wechat-refresh { min-width: 0; } .token-monitor-settings__head-copy { padding-right: 64px; } .token-monitor-settings__ribbon { right: 46px; opacity: .55; } }
      `}</style>

      <header className="token-monitor-settings__head">
        <img className="token-monitor-settings__ribbon" src={cuteAsset('cute-decoration-ribbon')} alt="" />
        <div className="token-monitor-settings__head-copy">
          <h1 className="token-monitor-settings__title">{props.title}</h1>
        </div>
        <button type="button" className="token-monitor-settings__close" aria-label="关闭监控设置" onClick={requestClose}>
          <img src={cuteAsset('cute-icon-close')} alt="" />
        </button>
      </header>

      <div className="token-monitor-settings__grid">
        <div className="token-monitor-settings__left-stack">
          <section className="token-monitor-settings__section" style={SECTION} aria-labelledby="rules-settings-title">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <div id="rules-settings-title"><SectionTitle iconName="cute-icon-warning" title="提醒规则" /></div>
              {props.loadProvider && <select aria-label="提醒供应商" value={provider} disabled={saveState === 'saving' || switchingProvider} onChange={(event) => { void selectProvider(event.target.value) }} style={{ maxWidth: '48%', minWidth: 0, color: 'inherit', background: 'var(--dsw-alias-monitor-button)', border: '1px solid var(--dsw-alias-monitor-button-border)', borderRadius: 8, padding: '4px 6px', font: 'inherit', fontSize: 12 }}>
                {[...new Set(['deepseek-official', ...(props.providers ?? [])])].map(id => <option key={id} value={id}>{id === 'deepseek-official' ? 'DeepSeek' : id}</option>)}
              </select>}
            </div>
            <fieldset disabled={switchingProvider} style={{ display: 'contents', border: 0, margin: 0, padding: 0, minWidth: 0 }}>
              <SwitchField id="daily-budget-enabled" label="启用今日预算" checked={draft.dailyBudgetEnabled} onChange={(value) => { applySwitch('dailyBudgetEnabled', value) }} />
              <label htmlFor="daily-budget-cny" className="token-monitor-settings__budget" style={{ opacity: draft.dailyBudgetEnabled ? 1 : 0.58 }}>
                <span style={{ display: 'block', fontSize: 14, fontWeight: 650 }}>预算阈值</span>
                <span className="token-monitor-settings__budget-row">
                  <span aria-hidden="true" style={{ color: 'var(--dsw-alias-monitor-muted)' }}>¥</span>
                  <input
                    id="daily-budget-cny"
                    className="token-monitor-settings__budget-input"
                    inputMode="decimal"
                    value={numberInputs['daily-budget-cny']}
                    disabled={!draft.dailyBudgetEnabled}
                    onFocus={() => { focusedInputRef.current = 'daily-budget-cny' }}
                    onBlur={() => { focusedInputRef.current = undefined; commitNumberInputs() }}
                    onChange={(event) => { setNumberInput('daily-budget-cny', event.currentTarget.value); setSaveError(undefined) }}
                    onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); commitNumberInputs() } }}
                  />
                </span>
              </label>
              <SwitchField id="budget-exceeded-notification-enabled" label="超过预算时提醒" checked={draft.budgetExceededNotificationEnabled} disabled={!draft.dailyBudgetEnabled} indent onChange={(value) => { applySwitch('budgetExceededNotificationEnabled', value) }} />
              <div className="token-monitor-settings__subgroup">
                <SwitchField id="peak-reminder-enabled" label="峰谷提醒总开关" checked={draft.peakReminderEnabled} onChange={(value) => { applySwitch('peakReminderEnabled', value) }} />
                <SwitchField id="peak-reminder-enter-peak" label="进入峰时段" checked={draft.peakReminderEnterPeak} disabled={!draft.peakReminderEnabled} indent onChange={(value) => { applySwitch('peakReminderEnterPeak', value) }} />
                <SwitchField id="peak-reminder-enter-valley" label="进入谷时段" checked={draft.peakReminderEnterValley} disabled={!draft.peakReminderEnabled} indent onChange={(value) => { applySwitch('peakReminderEnterValley', value) }} />
              </div>
              <div className="token-monitor-settings__subgroup">
                <SwitchField id="cache-hit-anomaly-enabled" label="缓存命中异常提醒" checked={draft.cacheHitAnomalyNotificationEnabled} onChange={(value) => { applySwitch('cacheHitAnomalyNotificationEnabled', value) }} />
                <label htmlFor="cache-hit-anomaly-threshold" className="token-monitor-settings__budget" style={{ opacity: draft.cacheHitAnomalyNotificationEnabled ? 1 : 0.58 }}>
                  <span style={{ display: 'block', fontSize: 14, fontWeight: 650 }}>缓存命中率阈值</span>
                  <span className="token-monitor-settings__budget-row"><input id="cache-hit-anomaly-threshold" className="token-monitor-settings__budget-input" inputMode="numeric" value={numberInputs['cache-hit-anomaly-threshold']} onFocus={() => { focusedInputRef.current = 'cache-hit-anomaly-threshold' }} onBlur={() => { focusedInputRef.current = undefined; commitNumberInputs() }} onChange={(event) => { setNumberInput('cache-hit-anomaly-threshold', event.currentTarget.value); setSaveError(undefined) }} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); commitNumberInputs() } }} /><span>%</span></span>
                </label>
                <label htmlFor="cache-hit-anomaly-consecutive" className="token-monitor-settings__budget" style={{ opacity: draft.cacheHitAnomalyNotificationEnabled ? 1 : 0.58 }}>
                  <span style={{ display: 'block', fontSize: 14, fontWeight: 650 }}>连续低于次数</span>
                  <span className="token-monitor-settings__budget-row"><input id="cache-hit-anomaly-consecutive" className="token-monitor-settings__budget-input" inputMode="numeric" value={numberInputs['cache-hit-anomaly-consecutive']} onFocus={() => { focusedInputRef.current = 'cache-hit-anomaly-consecutive' }} onBlur={() => { focusedInputRef.current = undefined; commitNumberInputs() }} onChange={(event) => { setNumberInput('cache-hit-anomaly-consecutive', event.currentTarget.value); setSaveError(undefined) }} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); commitNumberInputs() } }} /><span>次</span></span>
                </label>
              </div>
            </fieldset>
          </section>


        </div>

        <section className="token-monitor-settings__section token-monitor-settings__section--notification" style={SECTION} aria-labelledby="notification-settings-title">
          <div id="notification-settings-title"><SectionTitle iconName="cute-icon-notification" title="通知渠道" /></div>
          {props.petInstalled !== false && <SwitchField id="whale-bubble-enabled" label="鲸鱼娘通知气泡" checked={draft.whaleBubbleEnabled} disabled={switchingProvider} onChange={(value) => { applySwitch('whaleBubbleEnabled', value) }} />}
          {wechatInstalled && <>
            <SwitchField id="wechat-notifications-enabled" label="微信通知" checked={draft.wechatNotificationsEnabled} disabled={switchingProvider} onChange={(value) => { applySwitch('wechatNotificationsEnabled', value) }} />

            <div className="token-monitor-settings__wechat">
              <div aria-live="polite" className="token-monitor-settings__wechat-status">
                <span aria-hidden="true" style={{ width: 9, height: 9, marginTop: 5, borderRadius: '50%', background: status?.auth === 'authenticated' ? 'var(--dsw-alias-monitor-connected)' : 'var(--dsw-alias-monitor-scrollbar)', boxShadow: '0 0 0 4px var(--dsw-alias-monitor-soft-border)' }} />
                <div className="token-monitor-settings__wechat-status-copy">
                  <div style={{ color: 'var(--dsw-alias-monitor-label)', fontSize: 13, fontWeight: 700 }}>{connectionSummary(status)}</div>
                  {status?.identity !== undefined && <div style={descriptionStyle()}>账号 {status.identity.maskedUserId}</div>}
                  {deliverySummary(status) !== undefined && <div style={descriptionStyle()}>{deliverySummary(status)}</div>}
                  {status?.lastError !== undefined && <div style={{ ...descriptionStyle(), color: 'var(--dsw-alias-monitor-error)' }}>{status.lastError.message}</div>}
                  {statusError !== undefined && <div role="alert" style={{ ...descriptionStyle(), color: 'var(--dsw-alias-monitor-error)' }}>{statusError}</div>}
                </div>
                <button className="token-monitor-settings__wechat-refresh" type="button" disabled={action !== undefined} onClick={() => { void refreshStatus() }} style={actionButtonStyle(action !== undefined)}>刷新</button>
              </div>

              {ownershipHint !== undefined && <p className="token-monitor-settings__wechat-hint" data-wechat-ownership-hint="" style={{ margin: '10px 0 0', padding: '9px 11px', borderRadius: 10, background: 'var(--dsw-alias-monitor-warning-bg)', color: 'var(--dsw-alias-monitor-muted)', fontSize: 12, lineHeight: 1.5 }}>{ownershipHint}</p>}

              <div className="token-monitor-settings__qr-area" data-wechat-qr-area="">
                {loginSession === undefined
                  ? <span>登录微信后，二维码显示在此处</span>
                  : props.renderLoginQr === undefined
                    ? <Suspense fallback={null}><LocalLoginQr payload={loginSession.qrPayload} loadingLabel="正在生成二维码…" imageLabel="微信登录二维码" /></Suspense>
                    : props.renderLoginQr(loginSession.qrPayload)}
              </div>
              {loginSession !== undefined && (
                <div className="token-monitor-settings__qr-meta">
                  <div style={descriptionStyle()}>二维码约 {String(secondsRemaining ?? 0)} 秒后失效。</div>
                  <details style={{ marginTop: 5, textAlign: 'left' }}>
                    <summary style={{ cursor: 'pointer', color: 'var(--dsw-alias-monitor-muted)', fontSize: 12 }}>二维码无法加载？打开登录链接</summary>
                    <a href={loginSession.qrPayload} target="_blank" rel="noreferrer" data-wechat-qr-link="" style={{ display: 'block', marginTop: 6, color: 'var(--dsw-alias-monitor-brand)', fontSize: 11, overflowWrap: 'anywhere' }}>{loginSession.qrPayload}</a>
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
                <div role="alertdialog" aria-label="确认断开微信连接" style={{ marginTop: 12, padding: 12, border: '1px solid var(--dsw-alias-monitor-danger-panel-border)', borderRadius: 12, background: 'var(--dsw-alias-monitor-danger-panel-bg)' }}>
                  <div style={{ fontSize: 13, fontWeight: 750 }}>确定断开 DSH Host 管理的微信 bridge？</div>
                  <div style={descriptionStyle()}>只会操作 Host-owned 进程；外部 bridge 不会被结束。</div>
                  <div className="token-monitor-settings__disconnect-actions">
                    <button type="button" disabled={action !== undefined} onClick={() => { setDisconnectConfirmation(false) }} style={actionButtonStyle(action !== undefined)}>取消</button>
                    <button type="button" disabled={!canDisconnect} onClick={() => { void disconnect() }} style={{ ...actionButtonStyle(!canDisconnect, true), background: 'var(--dsw-alias-monitor-danger-button)', color: 'var(--dsw-alias-monitor-on-accent)', borderColor: 'transparent' }}>{action === 'disconnect' ? '正在断开…' : '确认断开'}</button>
                  </div>
                </div>
              )}

              {actionMessage !== undefined && <p className="token-monitor-settings__wechat-message" aria-live="polite" style={{ ...descriptionStyle(), marginBottom: 0, color: 'var(--dsw-alias-monitor-success)' }}>{actionMessage}</p>}
              {actionError !== undefined && <p className="token-monitor-settings__wechat-message" role="alert" style={{ ...descriptionStyle(), marginBottom: 0, color: 'var(--dsw-alias-monitor-error)' }}>{actionError}</p>}
            </div>
          </>}
        </section>

      </div>

      <footer className="token-monitor-settings__footer">
        <span
          className="token-monitor-settings__footer-message"
          aria-live="polite"
          data-token-monitor-settings-save-state={saveError === undefined ? saveState : 'error'}
          style={{ color: saveError === undefined ? 'var(--dsw-alias-monitor-success)' : 'var(--dsw-alias-monitor-error)', fontSize: 12 }}
        >
          {saveError ?? (saveState === 'saving' ? '正在自动保存…' : ' ')}
        </span>
      </footer>
    </form>
  )
}
