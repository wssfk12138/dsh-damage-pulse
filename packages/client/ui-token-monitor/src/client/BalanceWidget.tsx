import { MenuSurface } from './MenuSurface.tsx'
/**
 * 余额悬浮卡片：挂载在 frame 级浮动层（shell.overlay，右下角）。
 *
 * 数据源两个：
 * - 扣费：每秒增量拉取 /api/token-monitor/charge-events（Host collector 每次模型调用算出的精确 cost），
 *   按 seq 逐事件排队 → 每条独立飘字 + 余额逐条扣减 + 可打断的连续回弹 + 鲸鱼娘持续受击。
 * - 余额：每 15 秒拉取 /api/token-monitor/balance，校准显示余额（显示值以接口为准）；检测到余额变多（充值）→
 *   绿色「加费」飘字动画 + 数字绿色闪烁。
 *
 * 全局浮动层中的卡片按当前主任务的实际执行路由选择数据。
 */
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { ModuleManagerPanel } from './ModuleManagerPanel.tsx'
import { moduleInstalled, type createModuleState } from './moduleApi.ts'
import { currencySymbol } from './currencySymbol.ts'
import moduleCss from './module-effects.module.css'
import type { PropsLocale, InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import type { createBillingEvents } from './billingEvents.ts'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { type BillingSnapshot, type TokenMonitorSettingsSnapshot, type TokenMonitorSettingsPatchRequest } from '@deepseek-ai/dsh-token-monitor-contract'
import { TOKEN_MONITOR_WHALE_ASSET_BASE } from '@deepseek-ai/dsh-token-monitor-contract'
import { PRODUCT_NAME } from './branding.ts'
import type { RouteEligibilityLoader } from './routeEligibility.ts'
import { useRouteEligibility } from './useRouteEligibility.ts'
import { createTokenMonitorSettingsApi } from './settingsApi.ts'
import { TokenMonitorSettingsApiError } from './settingsApi.ts'
import { createWechatConnectionApi } from './wechatConnectionApi.ts'
import { createHostCompatApi } from './hostCompatApi.ts'
import { createNotificationEventsApi, type TokenMonitorNotificationEvent } from './notificationApi.ts'
import { applyNotificationPollResult, createNotificationQueueState, dequeueNotificationItem, notificationMatchesScope, type NotificationVisualItem } from './notificationQueue.ts'
import type { BalanceInfo } from './types.ts'
import { useDisplayScope } from './useDisplayScope.ts'
import { displayScopeKey, type DisplayScopeLoader } from './displayScope.ts'
import type { WhalePose as AnimatedWhalePose } from './WhaleGirlStage.tsx'
import { isPeakPeriod } from './peakPeriod.ts'
import { applyDebitToDisplay, comparableBalances } from './balanceMath.ts'
import { compactTokens, latencyTone } from './detail-model.ts'
import { isOfficialRoute } from './providerFamily.ts'
import { overlayTopMargin } from './window-frame.tsx'

const UsageDetailsWindow = lazy(() => import('./UsageDetailsWindow.tsx').then(module => ({ default: module.UsageDetailsWindow })))
const TokenMonitorSettingsPanel = lazy(() => import('./TokenMonitorSettingsPanel.tsx').then(module => ({ default: module.TokenMonitorSettingsPanel })))
const BillingRulesPanel = lazy(() => import('./BillingRulesPanel.tsx').then(module => ({ default: module.BillingRulesPanel })))
const WhaleGirlStage = lazy(() => import('./WhaleGirlStage.tsx').then(module => ({ default: module.WhaleGirlStage })))

type BalanceWidgetProps = PropsRuntime<'shell.overlay'> & PropsLocale<'token-monitor.details'> & Partial<InjectFace<{ hooks: { billingEvents: ReturnType<typeof createBillingEvents>; modules: ReturnType<typeof createModuleState> } }>> & {
  refreshModules?: () => Promise<void>
  loadRouteEligibility?: RouteEligibilityLoader
  loadDisplayScope?: DisplayScopeLoader
  loadModelCatalog?: (() => Promise<{
    groups: readonly { id: string; models: readonly { id: string }[] }[]
    failures: readonly { id: string; name?: string; message: string }[]
  }>) | undefined
  /** A settings owner may control this for immediate updates; otherwise the persisted Host setting is loaded. */
  /** 仅供全真发布展示页使用；不传时保持 DSH 实装行为。 */
  previewOverride?: {
    forcedPeak: boolean
    fixedPosition: { left: number; top: number }
    instanceId: string
    syncEpoch: number
  }
}

const settingsApi = createTokenMonitorSettingsApi()
const notificationEventsApi = createNotificationEventsApi()
const wechatConnectionApi = createWechatConnectionApi()
const hostCompatApi = createHostCompatApi()

const CARD: React.CSSProperties = {
  position: 'fixed',
  padding: '5px 11px 5px 13px',
  minWidth: 0,
  borderRadius: 8,
  background: 'var(--dsh-color-surface-overlay, rgba(30, 30, 30, 0.82))',
  color: 'var(--dsh-color-text, #e8e8e8)',
  fontSize: 15,
  lineHeight: '22px',
  fontVariantNumeric: 'tabular-nums',
  pointerEvents: 'auto',
  cursor: 'grab',
  userSelect: 'none',
  boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
  zIndex: 1000,
}

/**
 * 右键菜单固定使用暗色材料：宿主 MenuSurface 的填充变量随主题变化（浅色主题下是近白底），
 * 而菜单文字、图标和悬停高亮都按暗色卡片设计，浅色主题会出现白底白字。
 * 覆写宿主填充变量后，两个主题下都保持原来的暗色外观。
 */
const CONTEXT_MENU_MATERIAL = { '--dsw-menu-surface-fill': 'rgba(28, 28, 28, 0.96)' }

/** All enabled menu items share the same hover feedback; disabled switches stay inactive. */
const CONTEXT_MENU_HOVER = {
  onMouseEnter(event: React.MouseEvent<HTMLButtonElement>) {
    if (!event.currentTarget.disabled) event.currentTarget.style.background = 'rgba(255,255,255,0.10)'
  },
  onMouseLeave(event: React.MouseEvent<HTMLButtonElement>) {
    event.currentTarget.style.background = 'transparent'
  },
}

const RED = '#ff3b30'
const GREEN = '#30a46c'
const UNKNOWN_COLOR = '#8a8a8a'
const WHALE_ASSET_ROOT = TOKEN_MONITOR_WHALE_ASSET_BASE
/** 鲸鱼娘宽度按卡片宽度取比例：显示用量概览时卡片更宽，用较小比例维持角色视觉尺寸。 */
/** 鲸鱼娘宽度：无论悬浮卡片多宽，都取卡片宽度的 90%。 */
const WHALE_WIDTH = '90%'
/**
 * 扣血反馈（飘字字号、飘字起点与余额受击位移）跟随鲸鱼娘等比缩放：这些尺寸是按约 200px 宽的
 * 悬浮卡片调定的，卡片更宽则整体放大、更窄则整体缩小。鲸鱼娘始终是卡片宽度的 90%，因此两者同比
 * 例变化；鲸鱼娘自身的关键帧与冲击标记画在 512 画布内，随画布一起缩放。
 */
const DAMAGE_REFERENCE_WIDTH_PX = 200
const DAMAGE_SCALE_MIN = 0.75
const DAMAGE_SCALE_MAX = 1.8
const DAMAGE_FONT_SIZE = 18
const DAMAGE_MISS_FONT_SIZE = 23
const DAMAGE_LABEL_FONT_SIZE = 11
const DAMAGE_ORIGIN_WITH_WHALE_PX = 42
const DAMAGE_ORIGIN_PLAIN_PX = 8
/** 由悬浮卡片实测宽度换算扣血反馈的缩放系数。 */
function damageScaleFor(cardWidthPx: number): number {
  if (!Number.isFinite(cardWidthPx) || cardWidthPx <= 0) return 1
  return Math.min(DAMAGE_SCALE_MAX, Math.max(DAMAGE_SCALE_MIN, cardWidthPx / DAMAGE_REFERENCE_WIDTH_PX))
}
/**
 * 用量数据排版：两行取同一行高，↓/↑ 与 ◉、首字与总耗时因此逐行对齐；
 * 行距等于行高，文本正好填满行盒，既不裁切也不留半行空白。
 */
const DATA_ROW_HEIGHT = 17
const DATA_ROWS = `${DATA_ROW_HEIGHT}px ${DATA_ROW_HEIGHT}px`
const DATA_LINE_HEIGHT = `${DATA_ROW_HEIGHT}px`
/** 数据字号与详细用量窗口一致（13px），保证两处读数观感统一。 */
const DATA_FONT_SIZE = 13
/** 余额与峰谷取同一字号档：金额略大、峰谷略小，中文单字不再显小。 */
const AMOUNT_FONT_SIZE = 22
const AMOUNT_LINE_HEIGHT = '26px'
const PEAK_FONT_SIZE = 22
const PEAK_LINE_HEIGHT = '26px'
/** 金额、数据列与峰谷之间的间距：收紧后卡片更窄，鲸鱼娘按比例同步缩小。 */
const DISPLAY_GAP = 8
/** 不显示用量时「余额」字样字号：沿用调大前的观感，保持原布局。 */
const BALANCE_LABEL_FONT_SIZE = 16
type WhalePose = AnimatedWhalePose
const DEATH_ASSET = `${WHALE_ASSET_ROOT}/death-stranded-v6-trim.png`

/**
 * 附件参考节奏：扣费文字以最终字号快速显现，平稳上飘后渐隐。
 * 上飘距离在基准上放大 3 倍（用户要求 +200%），并按扣血反馈的缩放系数等比缩放；
 * 出现节奏、初速下沉 5px 与 prefers-reduced-motion 的精简版保持不变。
 */
const FLOAT_DRIFT_SCALE = 3
/**
 * 扣血飘字的基准时长（速度 100%）。用户要求把飘动速度降到 30%，因此时长等比拉长到约
 * 3.33 倍——距离不变、单位时间位移变小。出现节奏、渐隐曲线与 reduced-motion 精简版保持原样。
 */
const FLOAT_BASE_DURATION_MS = 1_250
const FLOAT_SPEED_FACTOR = 0.3
const FLOAT_DURATION_MS = Math.round(FLOAT_BASE_DURATION_MS / FLOAT_SPEED_FACTOR)
const FLOAT_ANIMATION = 'tkm-impact-float ' + String(FLOAT_DURATION_MS) + 'ms cubic-bezier(.2,.72,.3,1) forwards'
const floatKeyframes = (scale: number): string => {
  const drift = (base: number): string => String(Math.round(base * FLOAT_DRIFT_SCALE * scale * 10) / 10) + 'px'
  return `
@keyframes tkm-impact-float {
  0%   { opacity: 0; transform: translate3d(0, 5px, 0); }
  8%   { opacity: 1; transform: translate3d(0, 0, 0); }
  64%  { opacity: 1; transform: translate3d(0, -${drift(32)}, 0); }
  82%  { opacity: .76; transform: translate3d(0, -${drift(43)}, 0); }
  100% { opacity: 0; transform: translate3d(0, -${drift(56)}, 0); }
}
@keyframes tkm-impact-float-reduced {
  0%   { opacity: 0; transform: translate3d(0, 6px, 0); }
  35%  { opacity: 1; transform: translate3d(0, -6px, 0); }
  100% { opacity: 0; transform: translate3d(0, -30px, 0); }
}
@media (prefers-reduced-motion: reduce) {
  .tkm-impact-float {
    animation: tkm-impact-float-reduced 180ms ease-out forwards !important;
  }
}
`
}

/** 单条扣费文字；定位由鲸鱼娘头顶的独立反馈层负责。 */
const FLOAT: React.CSSProperties = {
  position: 'absolute',
  left: '50%',
  bottom: 0,
  fontFamily: 'Inter, "Segoe UI", "Microsoft YaHei", sans-serif',
  fontSize: DAMAGE_FONT_SIZE,
  fontWeight: 700,
  lineHeight: 1,
  fontVariantNumeric: 'tabular-nums',
  pointerEvents: 'none',
  zIndex: 1001,
  animation: FLOAT_ANIMATION,
  transformOrigin: '50% 100%',
  translate: '-50% 0',
  whiteSpace: 'nowrap',
  willChange: 'transform, opacity',
  textShadow: '0 1px 3px rgba(0,0,0,0.5)',
}

/** 悬浮窗位置持久化 key。 */
const POS_KEY = 'dsh-token-monitor-balance-pos'
const WHALE_VISIBLE_KEY = 'dsh-token-monitor-show-whale-girl'
const USAGE_OVERVIEW_KEY = 'dsh-token-monitor-show-usage-overview'

/** 从 localStorage 恢复上次位置；缺失或非法返回 null，交由右下角锚定处理。 */
function loadPos(): { left: number; top: number } | null {
  try {
    const raw = localStorage.getItem(POS_KEY)
    if (raw !== null) {
      const parsed = JSON.parse(raw) as { left?: unknown; top?: unknown }
      if (typeof parsed.left === 'number' && typeof parsed.top === 'number') {
        return { left: parsed.left, top: parsed.top }
      }
    }
  } catch {
    // 忽略解析失败，回退默认。
  }
  return null
}

/** 卡片与视口边缘的默认间距。 */
const ANCHOR_MARGIN_PX = 16

/** 持久化悬浮窗位置。 */
function savePos(pos: { left: number; top: number }): void {
  try {
    localStorage.setItem(POS_KEY, JSON.stringify(pos))
  } catch {
    // 忽略写入失败（隐私模式等）。
  }
}

/** An explicit local choice overrides Host defaults, including after remount. */
function loadWhaleVisible(): boolean | undefined {
  try {
    const raw = localStorage.getItem(WHALE_VISIBLE_KEY)
    if (raw === null) return undefined
    const parsed = JSON.parse(raw)
    return typeof parsed === 'boolean' ? parsed : undefined
  } catch {
    return undefined
  }
}

function loadUsageOverviewVisible(): boolean {
  try { const raw = localStorage.getItem(USAGE_OVERVIEW_KEY); return raw === null ? true : JSON.parse(raw) === true } catch { return true }
}
interface UsageOverview {
  sessionId?: string
  provider?: string
  model?: string
  /** 这条用量记录的请求时间（epoch 毫秒），用于在悬浮提示里标明记录时间。 */
  timestamp?: number
  inputTokens: number | null
  outputTokens: number | null
  cacheReadTokens: number | null
  firstMs: number | null
  totalMs: number | null
}
/** Token 数值格式与详细用量窗口完全一致（K 一位小数、M 两位小数）。 */
function fmtTokens(value: number | null): string {
  return value === null || !Number.isFinite(value) ? '未记录' : compactTokens(value)
}
/** 延迟格式与详细用量窗口一致：秒保留两位小数，缺少可靠时间时显示“未记录”。 */
function fmtLatency(value: number | null): string {
  return value === null || !Number.isFinite(value) || value <= 0 ? '未记录' : (value / 1000).toFixed(2) + ' s'
}
/** 记录时间按北京时间显示，与详细用量窗口的时间口径保持一致。 */
function fmtRecordTime(value?: number): string {
  return value === undefined || !Number.isFinite(value) ? '未记录' : new Date(value + 8 * 3600_000).toISOString().slice(0, 19).replace('T', ' ')
}
/** 延迟色条颜色，快慢分档沿用详细用量窗口的 latencyTone 阈值。 */
function latencyColor(value: number | null, total: boolean): string {
  const ms = value === null || !Number.isFinite(value) || value <= 0 ? undefined : value
  const tone = latencyTone(ms, total)
  return tone === 'good' ? '#30a46c' : tone === 'warn' ? '#eab308' : tone === 'bad' ? '#ff3b30' : UNKNOWN_COLOR
}
/** 缺失数据统一用中性灰，避免“未记录”被误读为一条正常记录。 */
function tokenColor(value: number | null, tone: string): string {
  return value === null || !Number.isFinite(value) ? UNKNOWN_COLOR : tone
}

/** 限制数值在 [min, max] 区间。 */
function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

/** 紧凑金额格式：小金额保留 4 位，大金额保留 2 位。 */
function fmtCost(cost: number): string {
  return cost < 0.01 ? cost.toFixed(4) : cost.toFixed(2)
}

function notificationText(item: NotificationVisualItem): string {
  const event: Exclude<TokenMonitorNotificationEvent, { kind: 'charge' }> = item.event
  if (event.kind === 'budget-threshold') {
    return `今日花费 ¥${fmtCost(event.payload.currentSpend)}，已达到预算阈值`
  }
  if (event.kind === 'peak-enter') return '进入峰时段，当前价格较高'
  if (event.kind === 'peak-exit') return '进入谷时段，当前价格较低'
  if (event.kind === 'cache-hit-anomaly') {
    return `缓存命中率偏低：最近 ${String(event.payload.sampleCount)} 次约 ${(event.payload.observedRate * 100).toFixed(1)}%，低于 ${(event.payload.threshold * 100).toFixed(0)}% 阈值`
  }
  return 'Token 消耗提醒'
}

/** 当前时刻是否落在高峰时段。 */
function isPeakNow(): boolean {
  return isPeakPeriod(Date.now())
}

interface FloatAnim {
  id: number
  eventId: string
  seq?: number
  text: string
  color: 'red' | 'green'
  damageKind: DamageKind
  label?: '命中' | '未命中' | '输出'
}

type DamageKind = 'normal' | 'miss' | 'output'

interface PendingFloat {
  eventId: string
  seq?: number
  text: string
  color: 'red' | 'green'
  kind: DamageKind
  label?: FloatAnim['label']
  debit?: number
  suppressWhaleReaction?: boolean
}

/**
 * 扣费事件是否有可用的计费规则。账号路由与官方 API key 路由同族：已保存的旧快照只有
 * `deepseek-official` 条目时按官方条目回退，与 Host billUsage 的回退口径一致；否则账号
 * 路由的扣费事件会被整体丢弃——既不飘字，也不触发鲸鱼娘的受击/扣血动画。
 */
function hasConfiguredBillingRule(snapshot: BillingSnapshot | undefined, provider: string | undefined, model: string | undefined): boolean {
  if (snapshot === undefined || !provider || !model) return false
  const providers = snapshot.rules.providers
  const providerRule = providers.find(item => item.provider === provider)
    ?? (isOfficialRoute(provider) ? providers.find(item => item.provider === 'deepseek-official') : undefined)
  return providerRule?.enabled === true && providerRule.models.some(item => item.model === model && item.enabled === true)
}

interface RawChargeEvent {
  provider?: string
  model?: string
  sourceEvent?: { sessionId: string; seq: number }
  id?: string
  seq: number
  cost: number
  timestamp: number
  kind?: 'hit' | 'output' | 'miss'
  damageKind?: 'normal' | 'miss'
  breakdown?: {
    cacheHit?: { tokens?: number; cost?: number }
    cacheMiss?: { tokens?: number; cost?: number }
    output?: { tokens?: number; cost?: number }
  }
}

const CHARGE_POLL_MS = 1_000
/** 余额轮询周期：与 Host 侧 BalanceService 同频，官方结算延迟很小，15s 足以让显示值贴近官网。 */
const BALANCE_POLL_MS = 15_000
const FLOAT_MS = FLOAT_DURATION_MS
const FLOAT_EMIT_INTERVAL_MS = 450
const FLASH_MS = 620
const WHALE_POSE_MS = 1_250
const MAX_ACTIVE_FLOATS = 64
const DRAG_THRESHOLD_PX = 4

export function BalanceWidget({
  previewOverride, loadRouteEligibility, loadDisplayScope, loadModelCatalog, useBillingEvents, useModules, refreshModules, useSessions, t: providedT,
}: BalanceWidgetProps) {
  // Older hosts injected only the route-eligibility capability. Keep that
  // narrow compatibility path while the current display-scope capability is
  // preferred whenever it is available. Tests and independently installed
  // hosts can therefore upgrade without briefly borrowing a stale provider.
  const t = (typeof providedT === 'function' ? providedT : ((key: string) => key)) as NonNullable<BalanceWidgetProps['t']>
  const billingEvents = useBillingEvents?.(state => state)
  const modules = useModules?.(state => state)
  const installed = (id: string) => useModules === undefined || moduleInstalled(modules, id)
  const petInstalled = installed('pet'), overviewInstalled = installed('overview')
  const notifyInstalled = installed('notify'), billingInstalled = installed('billing'), wechatInstalled = installed('wechat')
  const [managerOpen, setManagerOpen] = useState(false)
  const scope = useDisplayScope(useSessions, loadDisplayScope, useModules === undefined || modules !== undefined && !modules.pluginRemoved && !modules.restartRequired)
  const legacyEligible = useRouteEligibility(useSessions, loadRouteEligibility, loadDisplayScope !== undefined || previewOverride !== undefined)
  const scopeKey = displayScopeKey(scope)
  const activeProviderRef = useRef(scope?.provider)
  activeProviderRef.current = scope?.provider
  const legacyRouteActive = loadDisplayScope === undefined && loadRouteEligibility !== undefined && previewOverride === undefined
  const shouldPoll = scope !== undefined || previewOverride !== undefined || (legacyRouteActive && legacyEligible === true)
  const balanceUrl = `/api/token-monitor/balance?${new URLSearchParams({ provider: scope?.provider ?? 'deepseek-official' })}`
  // undefined = 加载中（不渲染）；null = 端点返回空（未查询到余额）。
  const [balanceInfo, setBalanceInfo] = useState<BalanceInfo | null | undefined>(undefined)
  // 本地维护的显示余额（null = 尚未从余额接口初始化基线）。
  const [display, setDisplay] = useState<number | null>(null)
  const [error, setError] = useState(false)
  // 余额数字闪烁：'red' 扣费 / 'green' 加费 / null 正常。
  const [flash, setFlash] = useState<'red' | 'green' | null>(null)
  const [anims, setAnims] = useState<FloatAnim[]>([])
  const [whalePose, setWhalePose] = useState<WhalePose>('idle')
  const [whaleImpactPulse, setWhaleImpactPulse] = useState(0)
  const [reviving, setReviving] = useState(false)
  const [showWhaleGirl, setShowWhaleGirl] = useState(() => loadWhaleVisible() ?? true)
  const whaleVisibilityChoice = useRef(loadWhaleVisible())
  const [showUsageOverview, setShowUsageOverview] = useState(loadUsageOverviewVisible)
  const [usageSnapshot, setUsageOverview] = useState<UsageOverview | null>(null)
  const [fallbackUsageSnapshot, setFallbackUsageSnapshot] = useState<UsageOverview | null>(null)
  const [balanceScriptAvailable, setBalanceScriptAvailable] = useState<boolean | undefined>(undefined)
  const [dataScopeKey, setDataScopeKey] = useState(scopeKey)
  const usageOverview = dataScopeKey === scopeKey
    ? (usageSnapshot ?? (balanceScriptAvailable === false ? fallbackUsageSnapshot : null))
    : (balanceScriptAvailable === false ? fallbackUsageSnapshot : null)
  const balanceAvailable = billingInstalled && dataScopeKey === scopeKey && balanceInfo !== undefined && balanceInfo !== null && !error
  /** 只有确认“当前模型没有可用余额脚本”才强制显示；状态未知时尊重用户的显示开关。 */
  const usageVisible = overviewInstalled && (!billingInstalled || showUsageOverview || balanceScriptAvailable === false)
  /** 正在显示的是“上一个可用模型快照”：当前模型没有自己的用量记录，且该供应商没有可用余额脚本。 */
  const usageShowsFallback = balanceScriptAvailable === false && usageSnapshot === null && usageOverview !== null
  const [settingsSnapshot, setSettingsSnapshot] = useState<TokenMonitorSettingsSnapshot>()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsProviders, setSettingsProviders] = useState<string[]>([])
  const [billingOpen, setBillingOpen] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [settingsError, setSettingsError] = useState<string>()
  const [notificationBubble, setNotificationBubble] = useState<string>()
  const [contextMenu, setContextMenu] = useState<{ left: number; top: number } | null>(null)
  // 悬浮窗位置（left/top），初始从 localStorage 恢复或锚定右下角。
  const restoredPosRef = useRef<{ left: number; top: number } | null | undefined>(undefined)
  if (restoredPosRef.current === undefined) restoredPosRef.current = previewOverride?.fixedPosition ?? loadPos()
  const [pos, setPos] = useState<{ left: number; top: number }>(() => restoredPosRef.current ?? { left: 0, top: 0 })
  // 用户未手动定位过时贴住右下角，卡片宽度随用量概览变化也不会被视口裁掉。
  const autoAnchorRef = useRef(previewOverride === undefined && restoredPosRef.current === null)
  const [dragging, setDragging] = useState(false)
  // 当前峰谷状态：true 高峰 / false 闲时。
  const [isPeak, setIsPeak] = useState(() => previewOverride?.forcedPeak ?? isPeakNow())

  const chargeSeq = useRef(0)
  const chargeStreamId = useRef<string>()
  // 扣费游标是否已建立基线：首次拉取只取当前 seq（余额接口值已含历史扣费），跳过历史 events。
  const chargeSeeded = useRef(false)
  const animId = useRef(0)
  const flashTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const animTimers = useRef<Set<ReturnType<typeof setTimeout>>>(new Set())
  const animQueue = useRef<PendingFloat[]>([])
  // 显示余额始终以接口快照为准；扣费只驱动飘字与递减动画，不再叠加待发射金额（避免显示值虚高）。
  const queueTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const whalePoseTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const lastCriticalAt = useRef(0)
  const activeWhaleSeverity = useRef(0)
  const lastBalanceSnapshot = useRef<BalanceInfo | null>(null)
  const revivingRef = useRef(false)
  const showWhaleGirlRef = useRef(showWhaleGirl && petInstalled)
  const balanceValueRef = useRef<HTMLSpanElement>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  // 拖拽起点：按下时的鼠标位置 + 卡片位置。
  const dragStart = useRef<{ x: number; y: number; left: number; top: number; pointerId: number; moved: boolean } | null>(null)
  const contextMenuRef = useRef<HTMLDivElement>(null)
  /** 悬浮卡片实测宽度：扣血反馈与受击位移按它等比缩放。 */
  const [cardWidthPx, setCardWidthPx] = useState(0)
  useEffect(() => {
    const node = cardRef.current
    if (node === null || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width
      if (typeof width === 'number' && width > 0) setCardWidthPx(width)
    })
    observer.observe(node)
    return () => { observer.disconnect() }
  }, [])
  const damageScale = damageScaleFor(cardWidthPx)
  const notificationSettingsRef = useRef<{ provider: string; snapshot: TokenMonitorSettingsSnapshot }>()
  const notificationQueueRef = useRef(createNotificationQueueState())
  const notificationSeeded = useRef(false)
  const notificationBubbleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    setDataScopeKey(scopeKey)
    setBalanceInfo(undefined)
    setDisplay(null)
    setUsageOverview(null)
    setBalanceScriptAvailable(undefined)
    setError(false)
    lastBalanceSnapshot.current = null
    chargeSeeded.current = false
    chargeSeq.current = 0
    chargeStreamId.current = undefined
    animQueue.current = []
    for (const timer of animTimers.current) clearTimeout(timer)
    animTimers.current.clear()
    clearTimeout(queueTimer.current)
    queueTimer.current = undefined
    clearTimeout(flashTimer.current)
    clearTimeout(whalePoseTimer.current)
    clearTimeout(notificationBubbleTimer.current)
    setAnims([])
    setFlash(null)
    setWhalePose('idle')
    setReviving(false)
    revivingRef.current = false
    activeWhaleSeverity.current = 0
    setNotificationBubble(undefined)
    notificationQueueRef.current = createNotificationQueueState()
    notificationSeeded.current = false
  }, [scopeKey, billingInstalled, petInstalled, notifyInstalled])

  /** 右键打开余额显示设置菜单，并限制菜单不超出视口。 */
  const onContextMenu = useCallback((event: React.MouseEvent) => {
    event.preventDefault()
    dragStart.current = null
    setDragging(false)
    const menuWidth = 176
    const menuHeight = 234
    // 顶部下限避开桌面外壳的标题条，否则菜单顶部会被窗口按钮盖住而点不到。
    const minTop = overlayTopMargin(4)
    setContextMenu({
      left: clamp(event.clientX, 4, Math.max(4, window.innerWidth - menuWidth - 4)),
      top: clamp(event.clientY, minTop, Math.max(minTop, window.innerHeight - menuHeight - 4)),
    })
  }, [])

  const toggleUsageOverview = useCallback(() => {
    setShowUsageOverview((visible) => {
      const next = !visible
      try { localStorage.setItem(USAGE_OVERVIEW_KEY, JSON.stringify(next)) } catch { /* retain session preference */ }
      return next
    })
    setContextMenu(null)
  }, [])

  /** 支持 Context Menu 键和 Shift+F10 打开设置。 */
  const onKeyDown = useCallback((event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      setContextMenu(null)
      return
    }
    if (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) {
      event.preventDefault()
      const rect = event.currentTarget.getBoundingClientRect()
      const minTop = overlayTopMargin(4)
      setContextMenu({
        left: clamp(rect.left, 4, Math.max(4, window.innerWidth - 180)),
        top: clamp(rect.bottom + 4, minTop, Math.max(minTop, window.innerHeight - 164)),
      })
    }
  }, [])

  const toggleWhaleGirl = useCallback(() => {
    const next = !showWhaleGirlRef.current
    whaleVisibilityChoice.current = next
    showWhaleGirlRef.current = next
    setShowWhaleGirl(next)
    try {
      localStorage.setItem(WHALE_VISIBLE_KEY, JSON.stringify(next))
    } catch {
      // Keep the explicit choice in memory when storage is unavailable.
    }
    setContextMenu(null)
  }, [])

  useEffect(() => {
    if (contextMenu === null) return
    const close = (event: PointerEvent) => {
      if (contextMenuRef.current?.contains(event.target as Node)) return
      setContextMenu(null)
    }
    const onBlur = () => setContextMenu(null)
    document.addEventListener('pointerdown', close)
    window.addEventListener('blur', onBlur)
    return () => {
      document.removeEventListener('pointerdown', close)
      window.removeEventListener('blur', onBlur)
    }
  }, [contextMenu])

  // Clamp against the rendered menu box, not a guessed height; this keeps the
  // right-click settings menu inside short viewports and after font/layout changes.
  useEffect(() => {
    if (contextMenu === null) return
    const frame = window.requestAnimationFrame(() => {
      const rect = contextMenuRef.current?.getBoundingClientRect()
      if (rect === undefined) return
      setContextMenu(current => current === null ? null : {
        left: clamp(current.left, 4, Math.max(4, window.innerWidth - rect.width - 4)),
        top: clamp(current.top, 4, Math.max(4, window.innerHeight - rect.height - 4)),
      })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [contextMenu])

  useEffect(() => {
    showWhaleGirlRef.current = showWhaleGirl && petInstalled
    if (showWhaleGirl && petInstalled) {
      setWhalePose('idle')
      return
    }
    if (whalePoseTimer.current !== undefined) clearTimeout(whalePoseTimer.current)
    whalePoseTimer.current = undefined
    activeWhaleSeverity.current = 0
    animQueue.current = animQueue.current.map(item => ({ ...item, suppressWhaleReaction: true }))
    clearTimeout(notificationBubbleTimer.current)
    notificationBubbleTimer.current = undefined
    setNotificationBubble(undefined)
    setWhalePose('idle')
    revivingRef.current = false
    setReviving(false)
  }, [showWhaleGirl, petInstalled])

  const applySettingsSnapshot = useCallback((snapshot: TokenMonitorSettingsSnapshot) => {
    setSettingsSnapshot(snapshot)
    if (whaleVisibilityChoice.current === undefined) {
      showWhaleGirlRef.current = snapshot.settings.showWhaleGirl && petInstalled
      setShowWhaleGirl(snapshot.settings.showWhaleGirl)
    }
  }, [petInstalled])

  const openSettings = useCallback(async () => {
    setContextMenu(null)
    setSettingsOpen(true)
    setSettingsError(undefined)
    if (loadModelCatalog) {
      void loadModelCatalog()
        .then(catalog => setSettingsProviders(catalog.groups.map(group => group.id)))
        .catch(() => { /* Existing provider remains available when catalog loading fails. */ })
    }
    try {
      applySettingsSnapshot(await settingsApi.get())
    } catch (error) {
      setSettingsError(error instanceof Error ? error.message : '设置读取失败，请稍后重试。')
    }
  }, [applySettingsSnapshot, loadModelCatalog])

  const loadProviderSettings = useCallback((provider: string) => createTokenMonitorSettingsApi(fetch, `/api/token-monitor/settings?${new URLSearchParams({ provider })}`).get(), [])
  const saveProviderSettings = useCallback(async (provider: string, request: TokenMonitorSettingsPatchRequest) => {
    const snapshot = await createTokenMonitorSettingsApi(fetch, `/api/token-monitor/settings?${new URLSearchParams({ provider })}`).patch(request)
    if (isOfficialRoute(provider)) applySettingsSnapshot(snapshot)
    if (activeProviderRef.current === provider && (notificationSettingsRef.current?.snapshot.revision ?? -1) <= snapshot.revision) {
      notificationSettingsRef.current = { provider, snapshot }
    }
    return snapshot
  }, [applySettingsSnapshot])

  useEffect(() => {
    notificationSettingsRef.current = undefined
    if (!scope?.provider) return
    const provider = scope.provider
    const controller = new AbortController()
    let loading = false
    const refresh = async () => {
      if (loading) return
      loading = true
      try {
        const snapshot = await createTokenMonitorSettingsApi(fetch, `/api/token-monitor/settings?${new URLSearchParams({ provider })}`).get(controller.signal)
        if (!controller.signal.aborted && (notificationSettingsRef.current?.snapshot.revision ?? -1) <= snapshot.revision) {
          notificationSettingsRef.current = { provider, snapshot }
        }
      } catch {
        // Fail closed until the exact provider's reminder preferences are known.
      } finally { loading = false }
    }
    const onFocus = () => void refresh()
    void refresh()
    window.addEventListener('focus', onFocus)
    return () => { controller.abort(); window.removeEventListener('focus', onFocus) }
  }, [scope?.provider])

  const saveSettings = useCallback(async (request: TokenMonitorSettingsPatchRequest) => {
    try {
      const snapshot = await settingsApi.patch(request)
      applySettingsSnapshot(snapshot)
      setSettingsError(undefined)
      return snapshot
    } catch (error) {
      if (error instanceof TokenMonitorSettingsApiError && error.code === 'CONFLICT') {
        try {
          applySettingsSnapshot(await settingsApi.get())
          setSettingsError('设置版本已更新，已重新读取最新值，请确认后再次保存。')
        } catch {
          setSettingsError('设置版本已过期，且最新值读取失败。')
        }
      }
      throw error
    }
  }, [applySettingsSnapshot])

  /** 卡片完整约束在视口内；窗口缩放只临时约束，不覆盖用户保存的位置。 */
  const constrainPos = useCallback((next: { left: number; top: number }) => {
    const rect = cardRef.current?.getBoundingClientRect()
    const width = rect?.width ?? 180
    const height = rect?.height ?? 34
    const minTop = overlayTopMargin(0)
    return {
      left: clamp(next.left, 0, Math.max(0, window.innerWidth - width)),
      top: clamp(next.top, minTop, Math.max(minTop, window.innerHeight - height)),
    }
  }, [])

  /** 未手动定位过时贴住右下角；返回是否已按锚定处理。 */
  const anchorToCorner = useCallback((width: number, height: number) => {
    if (!autoAnchorRef.current || width <= 0 || height <= 0) return false
    const next = {
      left: Math.max(ANCHOR_MARGIN_PX, window.innerWidth - width - ANCHOR_MARGIN_PX),
      top: Math.max(overlayTopMargin(ANCHOR_MARGIN_PX), window.innerHeight - height - ANCHOR_MARGIN_PX),
    }
    setPos(current => (current.left === next.left && current.top === next.top ? current : next))
    return true
  }, [])

  useEffect(() => {
    const onResize = () => {
      // WebView2 reports a zero-sized viewport while minimized. There is no
      // meaningful constraint in that state, and persisting a clamp would
      // destroy the user's chosen position when the window is restored.
      if (window.innerWidth <= 0 || window.innerHeight <= 0) return
      const rect = cardRef.current?.getBoundingClientRect()
      if (anchorToCorner(rect?.width ?? 0, rect?.height ?? 0)) return
      setPos((current) => {
        // A resize clamp is temporary. Restore the last user-saved position
        // when the viewport grows again, then apply the current bounds.
        const next = constrainPos(loadPos() ?? current)
        if (next.left === current.left && next.top === current.top) return current
        return next
      })
    }
    window.addEventListener('resize', onResize)
    onResize()
    return () => window.removeEventListener('resize', onResize)
  }, [anchorToCorner, constrainPos])

  /** 卡片宽度会随用量概览到达而变化，尺寸变化时重新约束，避免右侧内容被视口裁掉。 */
  useEffect(() => {
    const node = cardRef.current
    if (node === null || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => {
      if (window.innerWidth <= 0 || window.innerHeight <= 0) return
      const rect = node.getBoundingClientRect()
      if (anchorToCorner(rect.width, rect.height)) return
      setPos((current) => {
        const next = constrainPos(loadPos() ?? current)
        if (next.left === current.left && next.top === current.top) return current
        return next
      })
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [anchorToCorner, constrainPos])

  /** 拖拽开始：记录起点，捕获指针。 */
  const onPointerDown = useCallback((event: React.PointerEvent) => {
    if (previewOverride !== undefined) return
    if (event.button !== 0) return
    if ((event.target as HTMLElement).closest('[role=menu]') !== null) return
    dragStart.current = { x: event.clientX, y: event.clientY, left: pos.left, top: pos.top, pointerId: event.pointerId, moved: false }
    ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
  }, [pos, previewOverride])

  /** 拖拽移动：按位移更新位置，并限制在视口内。 */
  const onPointerMove = useCallback((event: React.PointerEvent) => {
    const start = dragStart.current
    if (start === null) return
    const dx = event.clientX - start.x
    const dy = event.clientY - start.y
    if (!start.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return
    if (!start.moved) {
      start.moved = true
      autoAnchorRef.current = false
      setDragging(true)
      setContextMenu(null)
    }
    setPos(constrainPos({ left: start.left + dx, top: start.top + dy }))
  }, [constrainPos])

  /** 拖拽结束：持久化位置。 */
  const onPointerUp = useCallback((event: React.PointerEvent) => {
    if (dragStart.current === null) return
    dragStart.current = null
    setDragging(false)
    if ((event.currentTarget as HTMLElement).hasPointerCapture(event.pointerId)) {
      ;(event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId)
    }
    // 持久化最终位置（用 pos 的最新值）。
    setPos((current) => {
      savePos(current)
      return current
    })
  }, [])

  /** 余额节点保留同一 DOM；连续扣费从当前视觉状态接续，不再靠 key 强制重播。 */
  const pulseBalance = useCallback((kind: DamageKind) => {
    const node = balanceValueRef.current
    if (node === null || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    for (const animation of node.getAnimations()) {
      try { animation.commitStyles() } catch { /* commitStyles 并非所有浏览器都支持。 */ }
      animation.cancel()
    }
    const strong = kind === 'miss'
    node.animate([
      { transform: getComputedStyle(node).transform === 'none' ? 'translate3d(0,0,0) scale(1)' : getComputedStyle(node).transform },
      { transform: strong ? `translate3d(${String(-2 * damageScale)}px,${String(3 * damageScale)}px,0) scale(.955)` : `translate3d(0,${String(2 * damageScale)}px,0) scale(.978)`, offset: .22 },
      { transform: strong ? `translate3d(${String(2 * damageScale)}px,${String(-1 * damageScale)}px,0) scale(1.025)` : `translate3d(0,${String(-1 * damageScale)}px,0) scale(1.012)`, offset: .55 },
      { transform: 'translate3d(0,0,0) scale(1)' },
    ], { duration: strong ? 620 : 440, easing: 'cubic-bezier(.2,.86,.25,1)', fill: 'forwards' })
  }, [damageScale])

  /** 将一条反馈真正发射到共同轨道。 */
  const emit = useCallback((pending: PendingFloat) => {
    const { eventId, seq, text, color, kind, label, debit, suppressWhaleReaction = false } = pending
    const id = ++animId.current
    const next = {
      eventId,
      text,
      color,
      damageKind: kind,
      ...(seq === undefined ? {} : { seq }),
      ...(label === undefined ? {} : { label }),
    }
    setAnims(list => [...list, { id, ...next }].slice(-MAX_ACTIVE_FLOATS))
    if (debit !== undefined && debit > 0) {
      setDisplay(previous => applyDebitToDisplay(previous, debit))
    }
    if (color === 'red' && revivingRef.current) {
      revivingRef.current = false
      setReviving(false)
    }
    if (showWhaleGirlRef.current && !suppressWhaleReaction) {
      const now = Date.now()
      const severity = color === 'green' ? 0 : kind === 'output' ? 1 : kind === 'normal' ? 2 : 3
      activeWhaleSeverity.current = Math.max(activeWhaleSeverity.current, severity)
      const pose: WhalePose = color === 'green'
        ? 'heal-happy'
        : activeWhaleSeverity.current === 1
          ? 'weak-pain'
          : activeWhaleSeverity.current === 2
            ? 'normal-pain'
            : (now - lastCriticalAt.current < 900 ? 'critical-combo' : 'critical-pain')
      if (kind === 'miss') lastCriticalAt.current = now
      setWhalePose(pose)
      setWhaleImpactPulse(pulse => pulse + 1)
      if (whalePoseTimer.current !== undefined) clearTimeout(whalePoseTimer.current)
      whalePoseTimer.current = setTimeout(() => {
        whalePoseTimer.current = undefined
        activeWhaleSeverity.current = 0
        setWhalePose('idle')
      }, WHALE_POSE_MS)
    }
    setFlash(color)
    pulseBalance(kind)
    if (flashTimer.current !== undefined) clearTimeout(flashTimer.current)
    flashTimer.current = setTimeout(() => setFlash(null), FLASH_MS)
    const timer = setTimeout(() => {
      animTimers.current.delete(timer)
      setAnims(list => list.filter(anim => anim.id !== id))
    }, FLOAT_MS)
    animTimers.current.add(timer)
  }, [pulseBalance])

  /** FIFO 发射器：首条立即出现，后续按指定 GIF 的约 450ms 节奏发射。 */
  const drainQueue = useCallback(function drain() {
    const next = animQueue.current.shift()
    if (next === undefined) {
      queueTimer.current = undefined
      return
    }
    try {
      emit(next)
    } finally {
      // 排程放进 finally：单条发射失败（浏览器动画 API 异常等）不能让整条队列停摆。
      // 保留一个完整发射间隔作为冷却窗，确保同批同步入队也会错峰。
      queueTimer.current = setTimeout(drain, FLOAT_EMIT_INTERVAL_MS)
    }
  }, [emit])

  /** 将反馈加入共同轨道队列，连续触发时保持可辨识的部分覆盖。 */
  const trigger = useCallback((
    eventId: string,
    text: string,
    color: 'red' | 'green',
    kind: DamageKind = 'normal',
    label?: FloatAnim['label'],
    seq?: number,
    debit?: number,
    suppressWhaleReaction = false,
  ) => {
    animQueue.current.push({
      eventId,
      text,
      color,
      kind,
      ...(seq === undefined ? {} : { seq }),
      ...(label === undefined ? {} : { label }),
      ...(debit === undefined ? {} : { debit }),
      suppressWhaleReaction: suppressWhaleReaction || !showWhaleGirlRef.current,
    })
    // 队列非空且没有在跑的发射链就启动，避免残留的定时器 id 让后续反馈永远排不出去。
    if (queueTimer.current === undefined && animQueue.current.length > 0) drainQueue()
  }, [drainQueue])

  useEffect(() => () => {
    if (flashTimer.current !== undefined) clearTimeout(flashTimer.current)
    if (queueTimer.current !== undefined) {
      clearTimeout(queueTimer.current)
      queueTimer.current = undefined
    }
    animTimers.current.forEach(timer => clearTimeout(timer))
    animTimers.current.clear()
    animQueue.current = []
    if (whalePoseTimer.current !== undefined) clearTimeout(whalePoseTimer.current)
  }, [])

  const cancelDrag = useCallback(() => {
    if (dragStart.current === null) return
    dragStart.current = null
    setDragging(false)
    setPos((current) => {
      const next = constrainPos(current)
      savePos(next)
      return next
    })
  }, [constrainPos])

  // 某些宿主或高刷新率指针设备可能在卡片之外结束拖动；窗口级兜底避免遗留 grabbing 状态。
  useEffect(() => {
    if (!dragging) return
    const finish = () => cancelDrag()
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', finish)
    window.addEventListener('blur', finish)
    return () => {
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', finish)
      window.removeEventListener('blur', finish)
    }
  }, [cancelDrag, dragging])

  // 峰谷状态刷新：每 30 秒重算一次（跨整点边界最多延迟 30 秒）。
  useEffect(() => {
    if (previewOverride !== undefined) {
      setIsPeak(previewOverride.forcedPeak)
      setPos(previewOverride.fixedPosition)
      return
    }
    const update = () => setIsPeak(isPeakNow())
    const timer = setInterval(update, 30_000)
    return () => clearInterval(timer)
  }, [previewOverride])

  useEffect(() => {
    if (!shouldPoll) return
    // 未安装计费模块按“无可用脚本”处理；供应商尚未解析时保持未知，避免把“还不知道”当成“没有脚本”而强制显示。
    if (!billingInstalled) { setBalanceScriptAvailable(false); return }
    if (!scope?.provider) return
    const controller = new AbortController()
    void (async () => {
      try {
        const response = await fetch('/api/token-monitor/balance-script?provider=' + encodeURIComponent(scope.provider), { cache: 'no-store', signal: controller.signal })
        if (!response.ok) return
        const value = await response.json() as { status?: string; source?: string }
        if (!controller.signal.aborted) setBalanceScriptAvailable(value.status === 'valid' || value.source === 'built-in')
      } catch {
        /* 脚本查询暂时失败按“脚本已配置”处理：余额查询故障不影响本地用量记录的显示与开关。 */
      }
    })()
    return () => controller.abort()
  }, [shouldPoll, billingInstalled, scopeKey])

  useEffect(() => {
    if (!shouldPoll || !usageVisible) return
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    let unavailable = false
    const query = scope ? '?' + new URLSearchParams({ provider: scope.provider, model: scope.model, ...(scope.sessionId === undefined ? {} : { sessionId: scope.sessionId }) }) : ''
    // 当前会话没有该模型的记录时，再按“供应商 + 模型”跨会话取该模型最近一条成功记录：
    // 用户要求“只要之前用过该模型就显示它的用量”，同时不得借用其它模型的数据。
    const modelQuery = scope && scope.sessionId !== undefined ? '?' + new URLSearchParams({ provider: scope.provider, model: scope.model }) : query
    const read = async (search: string): Promise<UsageOverview | null | undefined> => {
      try {
        const response = await fetch('/api/token-monitor/modules/overview' + search, { cache: 'no-store', signal: controller.signal })
        if (response.status === 204) { unavailable = true; void refreshModules?.(); return undefined }
        return response.ok ? await response.json() as UsageOverview | null : undefined
      } catch { return undefined /* Keep the current scope's last telemetry during transient failures. */ }
    }
    const poll = async () => {
      let data = await read(query)
      if (data === null && modelQuery !== query) data = await read(modelQuery)
      if (!controller.signal.aborted && data !== undefined) {
        setUsageOverview(data)
        if (data !== null) setFallbackUsageSnapshot(data)
      }
      if (!controller.signal.aborted && !unavailable) timer = setTimeout(() => { void poll() }, 1000)
    }
    void poll()
    return () => { controller.abort(); clearTimeout(timer) }
  }, [shouldPoll, usageVisible, scope, refreshModules])

  // 扣费轮询：每秒增量拉取；严格按 seq 逐事件入队，不按类型聚合或重排。
  useEffect(() => {
    if (!shouldPoll || !billingInstalled) return
    let cancelled = false
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const poll = async () => {
      try {
        const res = await fetch(`/api/token-monitor/charge-events?since=${chargeSeq.current}`, { cache: 'no-store', signal: controller.signal })
        if (!res.ok) return
        const data = (await res.json()) as {
          streamId?: string
          seq: number
          firstSeq?: number
          dropped?: boolean
          events: RawChargeEvent[]
        }
        if (cancelled) return
        const streamChanged = chargeStreamId.current !== undefined && data.streamId !== chargeStreamId.current
        const seqRegressed = Number.isSafeInteger(data.seq) && data.seq < chargeSeq.current
        const gapDetected = data.dropped === true
          || (Number.isSafeInteger(data.firstSeq) && chargeSeq.current < (data.firstSeq as number) - 1)
        if (!chargeSeeded.current) {
          // 首次：只建立游标基线（跳过余额接口已含的历史扣费，避免重复扣减）。
          chargeSeeded.current = true
          chargeStreamId.current = data.streamId
          chargeSeq.current = data.seq
          return
        }
        if (streamChanged || seqRegressed || gapDetected) {
          chargeStreamId.current = data.streamId
          chargeSeq.current = data.seq
          try {
            const balanceRes = await fetch(balanceUrl, { cache: 'no-store', signal: controller.signal })
            if (balanceRes.ok) {
              const balance = (await balanceRes.json()) as BalanceInfo | null
              if (!cancelled) {
                setBalanceInfo(balance)
                lastBalanceSnapshot.current = balance
                setDisplay(balance?.totalBalance ?? null)
              }
            }
          } catch {
            // 校准失败时由常规余额轮询重试。
          }
          return
        }
        const events = [...(data.events ?? [])]
          .filter(event => Number.isFinite(event.seq) && event.seq > chargeSeq.current)
          .sort((left, right) => left.seq - right.seq)
        if (events.length === 0) return
        if (cancelled) return
        for (const event of events) {
          // 游标先推进再做飘字/动画：视觉管线抛错时不能让客户端下一轮重复拉取
          // 并重复扣减同一条扣费（原实现把该赋值放在视觉处理之后，异常会被下面的
          // catch 吞掉，游标停在原地，于是每秒重放整本账）。
          chargeSeq.current = Math.max(chargeSeq.current, event.seq)
          if (scope) {
            const foreign = event.provider !== scope.provider || event.model !== scope.model || !scope.sessionId
              || event.sourceEvent?.sessionId !== scope.sessionId
            if (foreign) continue
          }
          const unqualified = useBillingEvents !== undefined
            && !hasConfiguredBillingRule(billingEvents?.snapshot, event.provider ?? scope?.provider, event.model ?? scope?.model)
          if (unqualified) continue
          const eventId = event.id ?? `charge-${event.seq}`
          const topKind = event.kind
          const parts: Array<{ suffix: string; cost: number; kind: DamageKind; label: FloatAnim['label'] }> = []
          if (topKind !== undefined) {
            parts.push({
              suffix: topKind,
              cost: event.cost,
              kind: topKind === 'miss' ? 'miss' : topKind === 'output' ? 'output' : 'normal',
              label: topKind === 'miss' ? '未命中' : topKind === 'output' ? '输出' : '命中',
            })
          } else {
            const hit = Number(event.breakdown?.cacheHit?.cost ?? 0)
            const output = Number(event.breakdown?.output?.cost ?? 0)
            const miss = Number(event.breakdown?.cacheMiss?.cost ?? 0)
            if ([hit, output, miss].every(cost => Number.isFinite(cost) && cost >= 0) && hit + output + miss > 0) {
              // 旧格式事件没有顶层 kind；只在单个事件内部按计费明细的稳定顺序展开。
              if (hit > 0) parts.push({ suffix: 'hit', cost: hit, kind: 'normal', label: '命中' })
              if (output > 0) parts.push({ suffix: 'output', cost: output, kind: 'output', label: '输出' })
              if (miss > 0) parts.push({ suffix: 'miss', cost: miss, kind: 'miss', label: '未命中' })
            } else {
              const fallbackKind: DamageKind = event.damageKind === 'miss' ? 'miss' : 'normal'
              parts.push({
                suffix: 'legacy', cost: event.cost, kind: fallbackKind,
                label: fallbackKind === 'miss' ? '未命中' : '命中',
              })
            }
          }
          for (const part of parts) {
            if (!Number.isFinite(part.cost) || part.cost <= 0) continue
            const localDebit = isOfficialRoute(scope?.provider) && lastBalanceSnapshot.current?.currency === 'CNY' ? part.cost : undefined
            trigger(`${eventId}-${part.suffix}`, `-${fmtCost(part.cost)}¥`, 'red', part.kind, part.label, event.seq, localDebit)
          }
        }
      } catch {
        // 扣费轮询失败静默（不影响余额显示）。
      } finally {
        if (!cancelled) timer = setTimeout(() => { void poll() }, CHARGE_POLL_MS)
      }
    }
    void poll()
    return () => {
      cancelled = true
      controller.abort()
      clearTimeout(timer)
    }
  }, [shouldPoll, billingInstalled, trigger, scope, balanceUrl, billingEvents, useBillingEvents])

  // 余额轮询：每 15 秒校准显示余额，检测充值（余额变多）触发绿色动画。
  useEffect(() => {
    if (!shouldPoll || !billingInstalled) return
    let cancelled = false
    const controller = new AbortController()
    let inFlight = false
    const nativeAccount = scope?.provider === 'deepseek-account'
    let timer: ReturnType<typeof setTimeout> | undefined
    const poll = async () => {
      if (cancelled || inFlight) return
      inFlight = true
      try {
        const res = await fetch(balanceUrl, { cache: 'no-store', signal: controller.signal })
        if (!res.ok) {
          if (!cancelled) setError(true)
          return
        }
        const data = (await res.json()) as BalanceInfo | null
        if (cancelled) return
        setBalanceInfo(data)
        setError(false)
        if (data !== null) {
          const previousSnapshot = lastBalanceSnapshot.current
          const comparable = comparableBalances(previousSnapshot, data)
          const grew = comparable && data.totalBalance > previousSnapshot.totalBalance + 1e-9
          const crossedFromDepleted = comparable && previousSnapshot.totalBalance <= 0 && data.totalBalance > 0
          // 先落权威快照与显示值，再做充值动画：视觉管线抛错不能连校准一起带走。
          lastBalanceSnapshot.current = data
          setDisplay(data.totalBalance)
          if (grew) {
            trigger(
              `heal-${Date.now()}`,
              `+${fmtCost(data.totalBalance - previousSnapshot.totalBalance)}${currencySymbol(data.currency)}`,
              'green',
              'normal',
              undefined,
              undefined,
              undefined,
              crossedFromDepleted,
            )
          }
          if (crossedFromDepleted && showWhaleGirlRef.current) {
            if (whalePoseTimer.current !== undefined) clearTimeout(whalePoseTimer.current)
            whalePoseTimer.current = undefined
            activeWhaleSeverity.current = 0
            revivingRef.current = true
            setReviving(true)
            setWhalePose('revive-recharge')
          } else if (!comparable || data.totalBalance <= 0) {
            if (whalePoseTimer.current !== undefined) clearTimeout(whalePoseTimer.current)
            whalePoseTimer.current = undefined
            revivingRef.current = false
            setReviving(false)
            setWhalePose('idle')
          }
        } else {
          lastBalanceSnapshot.current = null
          setDisplay(null)
          clearTimeout(whalePoseTimer.current)
          revivingRef.current = false
          setReviving(false)
          setWhalePose('idle')
        }
      } catch {
        if (!cancelled) setError(true)
      } finally {
        inFlight = false
        // API-key cache expires 15s after completion; schedule its next read
        // from completion too, keeping the existing cache and failure backoff.
        if (!cancelled && !nativeAccount) timer = setTimeout(() => { void poll() }, BALANCE_POLL_MS)
      }
    }
    void poll()
    // Fixed start cadence; request latency does not add another 15 seconds.
    if (nativeAccount) timer = setInterval(() => { void poll() }, BALANCE_POLL_MS)
    return () => {
      cancelled = true
      controller.abort()
      clearInterval(timer)
      clearTimeout(timer)
    }
  }, [shouldPoll, billingInstalled, trigger, balanceUrl, scopeKey])

  useEffect(() => {
    if (!shouldPoll) return
    const controller = new AbortController()
    const refresh = async () => {
      try {
        const snapshot = await settingsApi.get(controller.signal)
        if (!controller.signal.aborted) applySettingsSnapshot(snapshot)
      } catch {
        // 设置接口失败时保留共享默认值，不影响余额、预算和动画数据流。
      }
    }
    const onFocus = () => void refresh()
    void refresh()
    window.addEventListener('focus', onFocus)
    return () => {
      controller.abort()
      window.removeEventListener('focus', onFocus)
    }
  }, [applySettingsSnapshot, shouldPoll])

  const consumeNotification = useCallback(() => {
    const result = dequeueNotificationItem(notificationQueueRef.current, Date.now())
    notificationQueueRef.current = result.state
    if (!('item' in result)) return
    const config = notificationSettingsRef.current
    if (!notifyInstalled || !petInstalled || !showWhaleGirlRef.current || config?.provider !== scope?.provider
      || config?.snapshot.settings.whaleBubbleEnabled !== true
      || !notificationMatchesScope(result.item.event, scope)) return
    setNotificationBubble(notificationText(result.item))
    if (notificationBubbleTimer.current !== undefined) clearTimeout(notificationBubbleTimer.current)
    notificationBubbleTimer.current = setTimeout(() => {
      notificationBubbleTimer.current = undefined
      setNotificationBubble(undefined)
    }, 10_000)
  }, [scope?.provider, scope?.model, scope?.sessionId, notifyInstalled, petInstalled])

  useEffect(() => {
    if (!shouldPoll || !notifyInstalled) return
    const timer = setInterval(consumeNotification, 250)
    return () => clearInterval(timer)
  }, [consumeNotification, shouldPoll, notifyInstalled])

  useEffect(() => {
    if (!shouldPoll || !notifyInstalled) return
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const poll = async () => {
      const result = await notificationEventsApi.poll(notificationQueueRef.current.cursor, controller.signal)
      if (controller.signal.aborted) return
      if (!result.ok && result.failure.kind === 'unavailable') {
        void refreshModules?.()
        return
      }
      timer = setTimeout(() => void poll(), 1_000)
      if (!result.ok) return
      if (!notificationSeeded.current) {
        notificationSeeded.current = true
        notificationQueueRef.current = {
          ...notificationQueueRef.current,
          cursor: { streamId: result.batch.streamId, seq: result.batch.seq },
        }
        return
      }
      const scopedEvents = result.batch.events.filter(event => notificationMatchesScope(event, scope))
      const scoped = { ...result, batch: { ...result.batch, events: scopedEvents } }
      const update = applyNotificationPollResult(notificationQueueRef.current, scoped, Date.now())
      notificationQueueRef.current = update.state
      consumeNotification()
    }
    void poll()
    return () => {
      controller.abort()
      clearTimeout(timer)
      if (notificationBubbleTimer.current !== undefined) clearTimeout(notificationBubbleTimer.current)
    }
  }, [consumeNotification, shouldPoll, scopeKey, notifyInstalled, refreshModules])

  // Keep the portal mounted across background conversation route changes.
  // Legacy route checks must settle before the card is visible; an explicit
  // ineligible route is therefore hidden and its polling effects are stopped.
  if (legacyRouteActive && legacyEligible !== true) return null
  const widgetHidden = modules?.pluginRemoved === true && !modules.cleanupPending

  const amountColor = flash === 'red' ? RED : flash === 'green' ? GREEN : 'var(--dsh-color-accent, #4c8dff)'
  const shownBalance = display ?? balanceInfo?.totalBalance ?? 0
  const whaleWidth = WHALE_WIDTH
  const depleted = balanceAvailable && shownBalance <= 0
  const onWhalePoseComplete = (completedPose: WhalePose) => {
    if (completedPose !== 'revive-recharge' || !revivingRef.current) return
    revivingRef.current = false
    setReviving(false)
    setWhalePose('idle')
  }
  /** 悬浮提示补充记录归属：供应商、记录所属模型与记录时间，避免把别的模型的数据误读成当前模型。 */
  const usageRecordNote = usageOverview == null
    ? ''
    : '；供应商 ' + (usageOverview.provider ?? '未记录') + ' · 模型 ' + (usageOverview.model ?? '未记录') + ' · 记录时间 ' + fmtRecordTime(usageOverview.timestamp)
  return (
    <div
      ref={cardRef}
      style={{ ...CARD, display: widgetHidden ? 'none' : CARD.display, left: pos.left, top: pos.top, cursor: previewOverride === undefined ? (dragging ? 'grabbing' : 'grab') : 'default' }}
      data-token-monitor-balance=""
      data-showcase-instance={previewOverride?.instanceId}
      data-showcase-peak={isPeak ? 'peak' : 'valley'}
      title="" aria-label="DeepSeek 账户余额（扣费实时、余额 15s 校准；可拖动）"
      tabIndex={0}
      onContextMenu={onContextMenu}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={cancelDrag}
      onLostPointerCapture={cancelDrag}
    >
      <style>{floatKeyframes(damageScale)}</style>
      {managerOpen && refreshModules && <ModuleManagerPanel
        snapshot={modules} refresh={refreshModules} onClose={() => setManagerOpen(false)}
        onConfigErased={(ids) => {
          if (ids.includes('pet')) { whaleVisibilityChoice.current = undefined; setShowWhaleGirl(true) }
          if (ids.includes('overview')) setShowUsageOverview(loadUsageOverviewVisible())
        }}
        t={t}
      />}
      {!balanceAvailable && !usageVisible && <button type="button" className={moduleCss.anchor} onPointerDown={event => event.stopPropagation()} onClick={() => setManagerOpen(true)} aria-label={t('modulesAnchor')}>⚙</button>}
      {contextMenu !== null && (
        <MenuSurface
          ref={contextMenuRef}
          role="menu"
          aria-label="余额显示设置"
          // An empty title blocks the balance card's inherited native tooltip.
          title=""
          onPointerDown={event => event.stopPropagation()}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.stopPropagation()
              setContextMenu(null)
            }
          }}
          style={{
            position: 'fixed',
            left: contextMenu.left,
            top: contextMenu.top,
            minWidth: 176,
            padding: 6,
            borderRadius: 'var(--dsw-radius-sm, var(--dsh-token-monitor-radius-sm))',
            ...CONTEXT_MENU_MATERIAL,
            color: '#e8e8e8',
            boxShadow: '0 6px 20px rgba(0,0,0,0.35)',
            border: '1px solid rgba(255,255,255,0.12)',
            zIndex: 1100,
          }}
        >
          <div style={{ padding: '2px 8px 5px', fontSize: 11, opacity: 0.65 }}>余额显示设置</div>

          {petInstalled && <button
            type="button"
            role="menuitemcheckbox"
            aria-checked={showWhaleGirl}
            onClick={toggleWhaleGirl}
            style={{
              display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '6px 8px',
              border: 0, borderRadius: 4, background: 'transparent', color: 'inherit',
              textAlign: 'left', cursor: 'pointer', font: 'inherit',
            }}
            {...CONTEXT_MENU_HOVER}
          >
            <span aria-hidden="true" style={{ width: 14, textAlign: 'center', color: '#79b8ff' }}>{showWhaleGirl ? '✓' : ''}</span>
            <span>显示鲸鱼娘</span>
          </button>}
          {overviewInstalled && <>
            <button type="button" role="menuitemcheckbox" aria-checked={usageVisible} disabled={!balanceAvailable} onClick={toggleUsageOverview} {...CONTEXT_MENU_HOVER} style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '6px 8px', border: 0, borderRadius: 4, background: 'transparent', color: 'inherit', textAlign: 'left', cursor: balanceAvailable ? 'pointer' : 'not-allowed', font: 'inherit' }}>
              <span aria-hidden="true" style={{ width: 14, textAlign: 'center', color: '#79b8ff' }}>{usageVisible ? '✓' : ''}</span>
              <span>显示用量概览</span>
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => { setContextMenu(null); setDetailsOpen(true) }}
              style={{
                display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '6px 8px',
                border: 0, borderRadius: 4, background: 'transparent', color: 'inherit',
                textAlign: 'left', cursor: 'pointer', font: 'inherit',
              }}
              {...CONTEXT_MENU_HOVER}
            >
              <span aria-hidden="true" style={{ width: 14, textAlign: 'center', color: '#79b8ff' }}>≡</span>
              <span>{t('usage')}</span>
            </button>
          </>}
          {notifyInstalled && <button
            type="button"
            role="menuitem"
            onClick={() => { void openSettings() }}
            style={{
              display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '6px 8px',
              border: 0, borderRadius: 4, background: 'transparent', color: 'inherit',
              textAlign: 'left', cursor: 'pointer', font: 'inherit',
            }}
            {...CONTEXT_MENU_HOVER}
          >
            <span aria-hidden="true" style={{ width: 14, textAlign: 'center', color: '#79b8ff' }}>⚙</span>
            <span>{t('notificationSettings')}</span>
          </button>}
          {billingInstalled && <button type="button" role="menuitem" onClick={() => { setContextMenu(null); setBillingOpen(true) }} {...CONTEXT_MENU_HOVER} style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '6px 8px', border: 0, borderRadius: 4, background: 'transparent', color: 'inherit', textAlign: 'left', cursor: 'pointer', font: 'inherit' }}><span aria-hidden="true" style={{ width: 14, textAlign: 'center', color: '#79b8ff' }}>¥</span><span>计费规则</span></button>}
          <button type="button" role="menuitem" onClick={() => { setContextMenu(null); setManagerOpen(true) }} {...CONTEXT_MENU_HOVER} style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '6px 8px', border: 0, borderRadius: 4, background: 'transparent', color: 'inherit', textAlign: 'left', cursor: 'pointer', font: 'inherit' }}><span aria-hidden="true" style={{ width: 14, textAlign: 'center', color: '#79b8ff' }}>↻</span><span>{t('modulesTitle')}</span></button>
        </MenuSurface>
      )}
      {overviewInstalled && detailsOpen && <Suspense fallback={null}><UsageDetailsWindow
        billingInstalled={billingInstalled} t={t} onClose={() => setDetailsOpen(false)}
      /></Suspense>}
      {/* 计费规则窗口自身是门户式非模态窗口：可拖动、可缩放，点空白处不关闭，也不遮挡后方对话操作。 */}
      {billingInstalled && billingOpen && <Suspense fallback={null}><BillingRulesPanel
        t={t} billingEvents={billingEvents} loadModelCatalog={loadModelCatalog} onClose={() => setBillingOpen(false)}
      /></Suspense>}
      {notifyInstalled && settingsOpen && (
        <div
          role="dialog"
          aria-label={PRODUCT_NAME + ' ' + t('notificationSettings')}
          style={{
            position: 'fixed', inset: 0, zIndex: 1200, display: 'grid', placeItems: 'center',
            padding: 16, background: 'rgba(25, 20, 34, 0.24)',
          }}
          onPointerDown={(event) => { if (event.target === event.currentTarget) setSettingsOpen(false) }}
        >
          {settingsError !== undefined && settingsSnapshot === undefined
            ? (
              <div role="alert" style={{ maxWidth: 420, padding: 20, borderRadius: 14, background: 'var(--dsh-color-surface, #fff)', color: 'var(--dsh-color-text, #292534)' }}>
                {settingsError}
                <button type="button" onClick={() => setSettingsOpen(false)} style={{ display: 'block', marginTop: 12 }}>关闭</button>
              </div>
            )
            : settingsSnapshot !== undefined && (
              <Suspense fallback={null}><TokenMonitorSettingsPanel
                title={t('notificationSettings')}
                wechatInstalled={wechatInstalled}
                petInstalled={petInstalled}
                snapshot={settingsSnapshot}
                onSave={saveSettings}
                providers={settingsProviders}
                loadProvider={loadProviderSettings}
                saveProvider={saveProviderSettings}
                onClose={() => setSettingsOpen(false)}
                wechatApi={wechatConnectionApi}
                hostCompatApi={hostCompatApi}
              /></Suspense>
            )}
        </div>
      )}
      {petInstalled && showWhaleGirl && balanceAvailable && depleted && !reviving && (
        <div
          aria-hidden="true"
          data-token-monitor-whale-depleted=""
          style={{
            position: 'absolute',
            left: '50%',
            bottom: 'calc(100% - 8px)',
            width: whaleWidth,
            aspectRatio: '1351 / 691',
            transform: 'translateX(-50%)',
            zIndex: 2,
            pointerEvents: 'none',
            overflow: 'visible',
          }}
        >
          <img
            src={DEATH_ASSET}
            alt=""
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              objectFit: 'contain',
              objectPosition: 'bottom center',
              display: 'block',
            }}
          />
        </div>
      )}
      {petInstalled && showWhaleGirl && (reviving || !depleted) && (
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            left: '50%',
            bottom: 'calc(100% - 8px)',
            width: whaleWidth,
            aspectRatio: '1 / 1',
            transform: 'translateX(-50%)',
            zIndex: 2,
            pointerEvents: 'none',
            overflow: 'visible',
          }}
          data-token-monitor-whale-layer=""
          data-token-monitor-whale-pose={whalePose}
        >
          <Suspense fallback={null}><WhaleGirlStage
            pose={whalePose}
            impactPulse={whaleImpactPulse}
            onPoseComplete={onWhalePoseComplete}
            {...(previewOverride?.syncEpoch === undefined ? {} : { syncEpoch: previewOverride.syncEpoch })}
          /></Suspense>
        </div>
      )}
      {billingInstalled && anims.length > 0 && !depleted && (
        <div
          aria-hidden="true"
          data-token-monitor-damage-layer="head-front"
          style={{
            position: 'absolute',
            left: '50%',
            bottom: showWhaleGirl
              ? `calc(100% + ${String(DAMAGE_ORIGIN_WITH_WHALE_PX * damageScale)}px)`
              : `calc(100% + ${String(DAMAGE_ORIGIN_PLAIN_PX * damageScale)}px)`,
            width: 0,
            height: 0,
            zIndex: 12,
            pointerEvents: 'none',
            overflow: 'visible',
          }}
        >
          {anims.map(anim => (
            <span
              key={anim.id}
              className="tkm-impact-float"
              data-charge-event-id={anim.eventId}
              data-charge-seq={anim.seq}
              data-charge-kind={anim.damageKind}
              style={{
                ...FLOAT,
                color: anim.color,
                display: 'flex',
                alignItems: 'baseline',
                justifyContent: 'center',
                gap: anim.damageKind === 'miss' ? 5 : 4,
                fontSize: (anim.damageKind === 'miss' ? DAMAGE_MISS_FONT_SIZE : DAMAGE_FONT_SIZE) * damageScale,
                fontWeight: 800,
                animation: FLOAT.animation,
                textShadow: anim.damageKind === 'miss'
                  ? '0 1px 3px rgba(0,0,0,0.76), 0 0 7px rgba(255,59,48,0.42)'
                  : FLOAT.textShadow,
              }}
            >
              {anim.label !== undefined && (
                <span style={{
                  color: RED,
                  fontSize: DAMAGE_LABEL_FONT_SIZE * damageScale,
                  fontWeight: 800,
                }}>
                  {anim.label}
                </span>
              )}
              <span>{anim.text}</span>
            </span>
          ))}
        </div>
      )}
      {notifyInstalled && petInstalled && notificationBubble !== undefined && showWhaleGirl && !depleted && (
        <div
          role="status"
          aria-live="polite"
          data-token-monitor-notification-bubble=""
          data-side={window.innerWidth - pos.left - (cardRef.current?.offsetWidth ?? 0) / 2 > 285 ? 'right' : 'left'}
          className={moduleCss.bubble}
          style={{ bottom: `calc(100% - 8px + ${(cardRef.current?.offsetWidth ?? 0) * (usageVisible ? .6 : .8) * .73}px)`, maxWidth: Math.min(260, window.innerWidth - 24) }}
        >
          {notificationBubble}
        </div>
      )}
      <div style={{ position: 'relative', zIndex: 4, display: 'inline-flex', alignItems: 'center', gap: DISPLAY_GAP, whiteSpace: 'nowrap' }} data-token-monitor-display="">
        {billingInstalled && !usageVisible && <span style={{ fontSize: BALANCE_LABEL_FONT_SIZE }}>{'余额'}</span>}
        {balanceAvailable && <span
          style={{
            position: 'relative',
            display: 'inline-block',
          }}
        >
          <span
            ref={balanceValueRef}
            style={{
              fontWeight: 700,
              fontSize: AMOUNT_FONT_SIZE,
              lineHeight: AMOUNT_LINE_HEIGHT,
              fontVariantNumeric: 'tabular-nums',
              display: 'inline-block',
              color: amountColor,
              transition: 'color 0.25s ease',
              transform: 'translate3d(0,0,0) scale(1)',
              willChange: 'transform',
            }}
          >
            {currencySymbol(balanceInfo?.currency)}{shownBalance.toFixed(2)}
          </span>
        </span>}
        {usageVisible && <div
          style={{ display: 'grid', gridAutoFlow: 'column', alignItems: 'center', columnGap: DISPLAY_GAP, fontSize: DATA_FONT_SIZE, lineHeight: DATA_LINE_HEIGHT, color: 'rgba(255,255,255,0.92)' }}
          aria-label={'最近一次成功请求：未缓存输入 ' + fmtTokens(usageOverview?.inputTokens ?? null) + '；输出 ' + fmtTokens(usageOverview?.outputTokens ?? null) + '；缓存命中 ' + fmtTokens(usageOverview?.cacheReadTokens ?? null) + '；首字延迟 ' + fmtLatency(usageOverview?.firstMs ?? null) + '；总耗时 ' + fmtLatency(usageOverview?.totalMs ?? null) + usageRecordNote}
        >
          <div data-token-monitor-token-layout={balanceAvailable ? 'stacked' : 'inline'} style={{ display: balanceAvailable ? 'grid' : 'flex', gridTemplateRows: balanceAvailable ? DATA_ROWS : undefined, gap: balanceAvailable ? 0 : DISPLAY_GAP, alignItems: 'center', justifyItems: 'center' }}>
            <div style={{ whiteSpace: 'nowrap' }}><span style={{ color: tokenColor(usageOverview?.inputTokens ?? null, '#30c878') }}>↓ {fmtTokens(usageOverview?.inputTokens ?? null)}</span>　<span style={{ color: tokenColor(usageOverview?.outputTokens ?? null, '#9b73ff') }}>↑ {fmtTokens(usageOverview?.outputTokens ?? null)}</span></div>
            <div style={{ color: tokenColor(usageOverview?.cacheReadTokens ?? null, '#16a8f5'), whiteSpace: 'nowrap' }}>◉ {fmtTokens(usageOverview?.cacheReadTokens ?? null)}</div>
          </div>
          <div style={{ display: 'grid', gridTemplateRows: DATA_ROWS, alignItems: 'center', justifyItems: 'start' }}>
            <div aria-label={'首字延迟 ' + fmtLatency(usageOverview?.firstMs ?? null)} style={{ color: latencyColor(usageOverview?.firstMs ?? null, false), borderLeft: '3px solid currentColor', paddingLeft: 7, whiteSpace: 'nowrap' }}>{fmtLatency(usageOverview?.firstMs ?? null)}</div>
            <div aria-label={'总耗时 ' + fmtLatency(usageOverview?.totalMs ?? null)} style={{ color: latencyColor(usageOverview?.totalMs ?? null, true), borderLeft: '3px solid currentColor', paddingLeft: 7, whiteSpace: 'nowrap' }}>{fmtLatency(usageOverview?.totalMs ?? null)}</div>
          </div>
        </div>}
        {billingInstalled && (previewOverride !== undefined || isOfficialRoute(scope?.provider)) && <span
          style={{
            fontWeight: 700,
            fontSize: PEAK_FONT_SIZE,
            lineHeight: PEAK_LINE_HEIGHT,
            marginLeft: 0,
            color: isPeak ? RED : GREEN,
            textShadow: isPeak
              ? '0 0 6px rgba(255,59,48,0.9), 0 0 14px rgba(255,59,48,0.55)'
              : '0 0 6px rgba(48,164,108,0.9), 0 0 14px rgba(48,164,108,0.55)',
            transition: 'color 0.3s ease, text-shadow 0.3s ease',
          }}
        >
          {isPeak ? '峰' : '谷'}
        </span>}
      </div>
      {usageShowsFallback && (
        <div
          data-token-monitor-usage-source="fallback"
          style={{
            position: 'absolute',
            top: 'calc(100% - 1px)',
            left: 0,
            maxWidth: Math.min(340, window.innerWidth - 24),
            padding: '1px 8px 2px',
            borderRadius: 6,
            background: 'var(--dsh-color-surface-overlay, rgba(30, 30, 30, 0.82))',
            color: 'rgba(255,255,255,0.72)',
            fontSize: 11,
            lineHeight: '14px',
            fontWeight: 400,
            whiteSpace: 'nowrap',
            pointerEvents: 'none',
          }}
        >
          {'用量概览 · 来源：上一个可用模型 ' + (usageOverview?.model ?? '未记录')}
        </div>
      )}
    </div>
  )
}
