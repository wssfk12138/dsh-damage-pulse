/**
 * 余额悬浮卡片：注册在 frame 级浮动层（shell.overlay，右下角），但渲染时 portal 到
 * document.body —— 宿主 .overlayLayer 是 z-index 20 的层叠上下文，卡片留在其中时
 * 自身 z-index 只在层内比较，会被 z-index 60 的右侧栏浮动面板整块盖住（见 CARD_Z_INDEX）。
 *
 * 数据源两个：
 * - 扣费：每秒增量拉取 /api/token-monitor/charge-events（Host collector 每次模型调用算出的精确 cost），
 *   按 seq 逐事件排队 → 每条独立飘字 + 余额逐条扣减 + 可打断的连续回弹 + 鲸鱼娘持续受击。
 * - 余额：每 60 秒拉取 /api/token-monitor/balance，校准显示余额；检测到余额变多（充值）→
 *   绿色「加费」飘字动画 + 数字绿色闪烁。
 *
 * 全局（root scope）组件，无 session 依赖。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { DEFAULT_TOKEN_MONITOR_SETTINGS, TOKEN_MONITOR_DAMAGE_EFFECT_LEVELS, TOKEN_MONITOR_MIN_HEALTH_BAR_CNY, type TokenMonitorDamageEffectLevel, type TokenMonitorHealthBarColor, type TokenMonitorSettingsPatch, type TokenMonitorSettingsSnapshot, type TokenMonitorSettingsPatchRequest } from '../../../../util/token-monitor-contract/src/index.ts'
import type { RouteEligibilityLoader } from './routeEligibility.ts'
import { createTokenMonitorSettingsApi, isUnknownSettingFieldError } from './settingsApi.ts'
import { TokenMonitorSettingsApiError } from './settingsApi.ts'
import { TokenMonitorSettingsPanel } from './TokenMonitorSettingsPanel.tsx'
import { createWechatConnectionApi } from './wechatConnectionApi.ts'
import { createNotificationEventsApi, type TokenMonitorNotificationEvent } from './notificationApi.ts'
import { applyNotificationPollResult, createNotificationQueueState, dequeueNotificationItem, type NotificationVisualItem } from './notificationQueue.ts'
import type { BalanceInfo } from './types.ts'
import { useRouteEligibility } from './useRouteEligibility.ts'
import { WhaleGirlStage, type WhalePose as AnimatedWhalePose } from './WhaleGirlStage.tsx'
import { isPeakPeriod } from './peakPeriod.ts'
import { applyDebitToDisplay } from './balanceMath.ts'
import { HEALTH_BAR_PALETTES, healthBarPalette } from './healthBarPalette.ts'
import { damageMagnitude, damageVisuals, sampleDirections, applyEffectLevel, DAMAGE_EFFECT_LABELS, MIN_MAGNITUDE, type DamageKind } from './damageScale.ts'

type BalanceWidgetProps = PropsRuntime<'shell.overlay'> & {
  loadRouteEligibility?: RouteEligibilityLoader
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

/**
 * 卡片 portal 到 body，所以该 z-index 与宿主同层比较。宿主分档：
 * shell.overlay 所在的 .overlayLayer = 20、右侧栏浮动面板 .floatHost = 60
 * （ui-sidebar-right 同样 portal 到 body）、dockkit 菜单 = 70、宿主浮层/菜单 ≥ 100、
 * 宿主 Modal/Toast ≥ 1000。取 65：盖过侧边栏浮动面板，又不压住宿主菜单与模态。
 */
const CARD_Z_INDEX = 65

const CARD: React.CSSProperties = {
  position: 'fixed',
  padding: '6px 12px',
  borderRadius: 8,
  background: 'var(--dsh-color-surface-overlay, rgba(30, 30, 30, 0.82))',
  color: 'var(--dsh-color-text, #e8e8e8)',
  fontSize: 16, // 与输入框字号一致，便于查看
  lineHeight: '22px',
  fontVariantNumeric: 'tabular-nums',
  pointerEvents: 'auto',
  cursor: 'grab',
  userSelect: 'none',
  boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
  zIndex: CARD_Z_INDEX,
}

const RED = '#ff3b30'
const GREEN = '#30a46c'
const WHALE_ASSET_ROOT = '/assets/dsh-token-monitor/whale-girl'
type WhalePose = AnimatedWhalePose
const DEATH_ASSET = `${WHALE_ASSET_ROOT}/death-stranded-v6-trim.png`

/**
 * 余额血条：余额占「满血值」的比例就是血条长度，扣费逐笔扣血，充值回血。
 * 配色来自用户在右键菜单里选的预设（见 healthBarPalette.ts），默认经典红；
 * 扣血的轻重不用换色表达，而是交给特效强度。
 */
/** 回血用的绿色冲击环与火花，与血条自身配色无关。 */
const HEALTH_HEAL = 'rgba(126, 255, 178, 0.95)'

/** 空血阈值：到达该比例后血条开始脉动告警。 */
const HEALTH_CRITICAL_RATIO = 0.2
const HEALTH_BAR_HEIGHT = 11
/** 一次受击特效的存活时间，与冲击环/火花动画时长对齐。 */
const BURST_MS = 460

/** 血条分段刻度：十格，和游戏血量条的读数习惯一致。 */
const HEALTH_BAR_TICKS: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  pointerEvents: 'none',
  backgroundImage: 'repeating-linear-gradient(90deg, transparent 0, transparent calc(10% - 1px), rgba(255,255,255,0.16) calc(10% - 1px), rgba(255,255,255,0.16) 10%)',
}

/** 附件参考节奏：扣费文字以最终字号快速显现，平稳上飘后渐隐。 */
const KEYFRAMES = `
@keyframes tkm-impact-float {
  0%   { opacity: 0; transform: translate3d(0, 5px, 0); }
  8%   { opacity: 1; transform: translate3d(0, 0, 0); }
  64%  { opacity: 1; transform: translate3d(0, -32px, 0); }
  82%  { opacity: .76; transform: translate3d(0, -43px, 0); }
  100% { opacity: 0; transform: translate3d(0, -56px, 0); }
}
@keyframes tkm-impact-float-reduced {
  0%   { opacity: 0; transform: translate3d(0, 6px, 0); }
  35%  { opacity: 1; transform: translate3d(0, -6px, 0); }
  100% { opacity: 0; transform: translate3d(0, -30px, 0); }
}
@keyframes tkm-health-critical {
  0%, 100% { box-shadow: inset 0 1px 3px rgba(0,0,0,0.55), 0 0 0 0 rgba(255,59,48,0); border-color: rgba(255,255,255,0.16); }
  50%      { box-shadow: inset 0 1px 3px rgba(0,0,0,0.55), 0 0 10px 1px rgba(255,59,48,0.72); border-color: rgba(255,96,84,0.62); }
}
/* 受击冲击环：从扣血位置炸开一圈，随后消失。 */
@keyframes tkm-health-shock {
  0%   { opacity: .95; transform: translate(-50%, -50%) scale(.3); }
  70%  { opacity: .45; }
  100% { opacity: 0;   transform: translate(-50%, -50%) scale(2.7); }
}
/* 受击火花：方向由 --tkm-spark-x / --tkm-spark-y 给出，一套关键帧覆盖六个方向。 */
@keyframes tkm-health-spark {
  0%   { opacity: 1; transform: translate(-50%, -50%) translate3d(0, 0, 0) scale(1); }
  100% { opacity: 0; transform: translate(-50%, -50%) translate3d(var(--tkm-spark-x, 0px), var(--tkm-spark-y, 0px), 0) scale(.25); }
}
@media (prefers-reduced-motion: reduce) {
  .tkm-impact-float {
    animation: tkm-impact-float-reduced 180ms ease-out forwards !important;
  }
  [data-token-monitor-health-bar] { animation: none !important; }
  [data-token-monitor-health-bar] > [data-health-fill] { transition: none !important; }
  [data-health-trail] { transition: none !important; }
  [data-health-burst] { display: none !important; }
}
`

/** 单条扣费文字；定位由鲸鱼娘头顶的独立反馈层负责。 */
const FLOAT: React.CSSProperties = {
  position: 'absolute',
  left: '50%',
  bottom: 0,
  fontFamily: 'Inter, "Segoe UI", "Microsoft YaHei", sans-serif',
  fontSize: 18,
  fontWeight: 700,
  lineHeight: 1,
  fontVariantNumeric: 'tabular-nums',
  pointerEvents: 'none',
  zIndex: 1001,
  animation: 'tkm-impact-float 1250ms cubic-bezier(.2,.72,.3,1) forwards',
  transformOrigin: '50% 100%',
  translate: '-50% 0',
  whiteSpace: 'nowrap',
  willChange: 'transform, opacity',
  textShadow: '0 1px 3px rgba(0,0,0,0.5)',
}

/** 悬浮窗位置持久化 key。 */
const POS_KEY = 'dsh-token-monitor-balance-pos'
const WHALE_VISIBLE_KEY = 'dsh-token-monitor-show-whale-girl'

/** 从 localStorage 恢复上次位置；缺失或非法则用右下角默认值。 */
function loadPos(): { left: number; top: number } {
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
  return { left: Math.max(0, window.innerWidth - 220), top: Math.max(0, window.innerHeight - 72) }
}

/** 持久化悬浮窗位置。 */
function savePos(pos: { left: number; top: number }): void {
  try {
    localStorage.setItem(POS_KEY, JSON.stringify(pos))
  } catch {
    // 忽略写入失败（隐私模式等）。
  }
}

/** 恢复鲸鱼娘显示偏好；首次使用默认显示。 */
function loadWhaleVisible(): boolean {
  try {
    const raw = localStorage.getItem(WHALE_VISIBLE_KEY)
    if (raw === null) return true
    const parsed = JSON.parse(raw)
    return typeof parsed === 'boolean' ? parsed : true
  } catch {
    return true
  }
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
  /** 扣血特效倍率，决定飘字字号。 */
  magnitude: number
}

interface PendingFloat {
  eventId: string
  seq?: number
  text: string
  color: 'red' | 'green'
  kind: DamageKind
  label?: FloatAnim['label']
  debit?: number
  /** 这一笔的金额（元），只用于决定特效强度；回血时是充值额。 */
  amount?: number
  suppressWhaleReaction?: boolean
}

/** 除事件本身外还能带上的信息；用对象而不是继续加位置参数，避免调用点出现一长串 undefined。 */
interface TriggerOptions {
  label?: FloatAnim['label']
  seq?: number
  debit?: number
  /** 这一笔的金额（元），用于决定特效强度。 */
  amount?: number
  suppressWhaleReaction?: boolean
}

/** 满血值：设置未到达或不可用时回落到共享默认值。 */
function resolveHealthMax(settings: TokenMonitorSettingsSnapshot | undefined): number {
  const configured = settings?.settings.healthBarMaxCny
  return typeof configured === 'number' && Number.isFinite(configured) && configured >= TOKEN_MONITOR_MIN_HEALTH_BAR_CNY
    ? configured
    : DEFAULT_TOKEN_MONITOR_SETTINGS.healthBarMaxCny
}

/**
 * 扣血火花方向环：十个方向等分一圈。取用数量随扣血多少变化，
 * 采样时按角度等分，避免截断前 N 个让火花全挤在一侧。
 */
const HEALTH_SPARKS: ReadonlyArray<{ x: number; y: number }> = [
  { x: 2, y: -17 }, { x: 13, y: -13 }, { x: 18, y: -4 }, { x: 17, y: 7 }, { x: 8, y: 14 },
  { x: -3, y: 16 }, { x: -13, y: 12 }, { x: -18, y: 3 }, { x: -16, y: -9 }, { x: -9, y: -15 },
]

interface RawChargeEvent {
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
const BALANCE_POLL_MS = 60_000
const FLOAT_MS = 1_250
const FLOAT_EMIT_INTERVAL_MS = 450
const FLASH_MS = 620
const WHALE_POSE_MS = 1_250
const MAX_ACTIVE_FLOATS = 64
const DRAG_THRESHOLD_PX = 4

export function BalanceWidget({ previewOverride, loadRouteEligibility, useSessions }: BalanceWidgetProps) {
  const routeEligible = useRouteEligibility(useSessions, loadRouteEligibility, previewOverride !== undefined)
  const shouldPoll = routeEligible !== false || previewOverride !== undefined
  // undefined = 加载中（不渲染）；null = 端点返回空（未查询到余额）。
  const [balanceInfo, setBalanceInfo] = useState<BalanceInfo | null | undefined>(undefined)
  // 本地维护的显示余额（null = 尚未从余额接口初始化基线）。
  const [display, setDisplay] = useState<number | null>(null)
  const [error, setError] = useState(false)
  // 余额数字闪烁：'red' 扣费 / 'green' 加费 / null 正常。
  const [flash, setFlash] = useState<'red' | 'green' | null>(null)
  const [anims, setAnims] = useState<FloatAnim[]>([])
  /** 每次扣血/回血重挂一次受击特效层：key 变化即重播 CSS 动画。 */
  const [hitBurst, setHitBurst] = useState<{ id: number; color: 'red' | 'green'; magnitude: number } | null>(null)
  const [whalePose, setWhalePose] = useState<WhalePose>('idle')
  const [whaleImpactPulse, setWhaleImpactPulse] = useState(0)
  const [reviving, setReviving] = useState(false)
  const [showWhaleGirl, setShowWhaleGirl] = useState(loadWhaleVisible)
  const [settingsSnapshot, setSettingsSnapshot] = useState<TokenMonitorSettingsSnapshot>()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsError, setSettingsError] = useState<string>()
  const [notificationBubble, setNotificationBubble] = useState<string>()
  const [settingsNotice, setSettingsNotice] = useState<string>()
  const [contextMenu, setContextMenu] = useState<{ left: number; top: number } | null>(null)
  // 用户意图位置：初始从 localStorage 恢复或默认右下角，只有拖动才会改写。
  const [intent, setIntent] = useState<{ left: number; top: number }>(() => previewOverride?.fixedPosition ?? loadPos())
  // 实际渲染位置：意图位置按当前视口限制后的结果，不写回存储。
  const [pos, setPos] = useState<{ left: number; top: number }>(intent)
  const [dragging, setDragging] = useState(false)
  // 当前峰谷状态：true 高峰 / false 闲时。
  const [isPeak, setIsPeak] = useState(() => previewOverride?.forcedPeak ?? isPeakNow())

  const chargeSeq = useRef(0)
  const chargeStreamId = useRef<string>()
  // 扣费游标是否已建立基线：首次拉取只取当前 seq（余额接口值已含历史扣费），跳过历史 events。
  const chargeSeeded = useRef(false)
  const animId = useRef(0)
  const burstId = useRef(0)
  const burstTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const healthBarRef = useRef<HTMLDivElement>(null)
  const flashTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const animTimers = useRef<Set<ReturnType<typeof setTimeout>>>(new Set())
  const animQueue = useRef<PendingFloat[]>([])
  const queueTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const whalePoseTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const lastCriticalAt = useRef(0)
  const activeWhaleSeverity = useRef(0)
  const lastBalanceSnapshot = useRef<number | null>(null)
  const revivingRef = useRef(false)
  const showWhaleGirlRef = useRef(showWhaleGirl)
  const balanceValueRef = useRef<HTMLSpanElement>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  // 拖拽起点：按下时的鼠标位置 + 卡片位置；next 记录本次拖动产生的最新位置。
  const dragStart = useRef<{ x: number; y: number; left: number; top: number; pointerId: number; moved: boolean; next: { left: number; top: number } | null } | null>(null)
  const contextMenuRef = useRef<HTMLDivElement>(null)
  const settingsRef = useRef(settingsSnapshot)
  const notificationQueueRef = useRef(createNotificationQueueState())
  const notificationSeeded = useRef(false)
  const notificationBubbleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const settingsNoticeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  /** 右键打开余额显示设置菜单，并限制菜单不超出视口。 */
  const onContextMenu = useCallback((event: React.MouseEvent) => {
    event.preventDefault()
    dragStart.current = null
    setDragging(false)
    const menuWidth = 200
    // 首帧的估算高度（含血条颜色色板与特效档位）；随后由渲染后的实测尺寸再夹一次。
    const menuHeight = 300
    setContextMenu({
      left: clamp(event.clientX, 4, Math.max(4, window.innerWidth - menuWidth - 4)),
      top: clamp(event.clientY, 4, Math.max(4, window.innerHeight - menuHeight - 4)),
    })
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
      setContextMenu({
        left: clamp(rect.left, 4, Math.max(4, window.innerWidth - 180)),
        top: clamp(rect.bottom + 4, 4, Math.max(4, window.innerHeight - 164)),
      })
    }
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
    showWhaleGirlRef.current = showWhaleGirl
    if (showWhaleGirl) {
      setWhalePose('idle')
      return
    }
    if (whalePoseTimer.current !== undefined) clearTimeout(whalePoseTimer.current)
    whalePoseTimer.current = undefined
    setWhalePose('idle')
    revivingRef.current = false
    setReviving(false)
  }, [showWhaleGirl])

  useEffect(() => {
    settingsRef.current = settingsSnapshot
  }, [settingsSnapshot])

  const applySettingsSnapshot = useCallback((snapshot: TokenMonitorSettingsSnapshot) => {
    setSettingsSnapshot(snapshot)
    setShowWhaleGirl(snapshot.settings.showWhaleGirl)
    try {
      localStorage.setItem(WHALE_VISIBLE_KEY, JSON.stringify(snapshot.settings.showWhaleGirl))
    } catch {
      // Host settings remain authoritative even when localStorage is unavailable.
    }
  }, [])

  /** 短暂显示一次操作反馈（当前用于设置写入失败），4 秒后自动消失。 */
  const showSettingsNotice = useCallback((message: string) => {
    setSettingsNotice(message)
    if (settingsNoticeTimer.current !== undefined) clearTimeout(settingsNoticeTimer.current)
    settingsNoticeTimer.current = setTimeout(() => {
      settingsNoticeTimer.current = undefined
      setSettingsNotice(undefined)
    }, 4_000)
  }, [])

  const openSettings = useCallback(async () => {
    setContextMenu(null)
    setSettingsOpen(true)
    setSettingsError(undefined)
    try {
      applySettingsSnapshot(await settingsApi.get())
    } catch (error) {
      setSettingsError(error instanceof Error ? error.message : '设置读取失败，请稍后重试。')
    }
  }, [applySettingsSnapshot])

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

  /**
   * 菜单里的单项设置写入：先写 Host，再由返回的权威快照更新界面。
   * 失败不能静默——错误本身分不清「Host 未落盘」与「已落盘但响应丢失」，
   * 因此回读一次权威快照对齐界面，并给出可见提示（原来空 catch 表现为点了没反应）。
   */
  const saveSettingsPatch = useCallback((patch: TokenMonitorSettingsPatch, failureNotice: string) => {
    void saveSettings({
      ...(settingsRef.current === undefined ? {} : { expectedRevision: settingsRef.current.revision }),
      patch,
    }).catch(async (error: unknown) => {
      // 宿主不认识这个字段时，回读快照也必然失败（整份快照过不了契约校验），
      // 套用「已按服务器上的值恢复」会误导：真正要做的是重启 DSH 让宿主对齐。
      if (isUnknownSettingFieldError(error)) {
        showSettingsNotice('宿主插件比当前页面旧，重启 DSH 后可保存该项设置')
        return
      }
      try {
        applySettingsSnapshot(await settingsApi.get())
        showSettingsNotice(`${failureNotice}，已按服务器上的值恢复。`)
      } catch {
        showSettingsNotice(`${failureNotice}，请稍后重试。`)
      }
    })
  }, [applySettingsSnapshot, saveSettings, showSettingsNotice])

  /**
   * 鲸鱼娘显示开关以 Host 设置为唯一所有者：localStorage 退化为首帧缓存
   * （只由 applySettingsSnapshot 写入），否则本地写入会被随后的焦点刷新/打开详细
   * 设置覆盖，表现为「取消勾选后自己变回勾选」。
   */
  const toggleWhaleGirl = useCallback(() => {
    setContextMenu(null)
    saveSettingsPatch({ showWhaleGirl: !showWhaleGirlRef.current }, '设置保存失败')
  }, [saveSettingsPatch])

  /**
   * 换血条配色。菜单保持打开：用户可以连着点几个颜色当场比，选中态由 Host 快照回填，
   * 不依赖本地乐观状态，避免写入失败时菜单显示的颜色和血条实际颜色不一致。
   */
  const chooseHealthBarColor = useCallback((color: TokenMonitorHealthBarColor) => {
    saveSettingsPatch({ healthBarColor: color }, '血条颜色保存失败')
  }, [saveSettingsPatch])

  /** 换扣血特效档位；同样保持菜单打开，方便对着下一笔扣费直接比。 */
  const chooseDamageEffectLevel = useCallback((level: TokenMonitorDamageEffectLevel) => {
    saveSettingsPatch({ damageEffectLevel: level }, '扣血特效设置保存失败')
  }, [saveSettingsPatch])

  /** 卡片完整约束在视口内。 */
  const constrainPos = useCallback((next: { left: number; top: number }) => {
    const rect = cardRef.current?.getBoundingClientRect()
    const width = rect?.width ?? 180
    const height = rect?.height ?? 34
    return {
      left: clamp(next.left, 0, Math.max(0, window.innerWidth - width)),
      top: clamp(next.top, 0, Math.max(0, window.innerHeight - height)),
    }
  }, [])

  /** 提交用户选定的位置：更新意图并持久化。视口变化不走这里。 */
  const commitPos = useCallback((next: { left: number; top: number }) => {
    setIntent(next)
    savePos(next)
  }, [])

  /**
   * 视口变化只修正渲染位置，意图位置与存储都不动。
   * 缩小窗口或最小化时 innerHeight 会塌陷（WebView2 最小化时报 0），
   * 把 clamp 结果写回存储会让用户调好的位置永久停在顶端。
   */
  useEffect(() => {
    const onResize = () => setPos(constrainPos(intent))
    window.addEventListener('resize', onResize)
    onResize()
    return () => window.removeEventListener('resize', onResize)
  }, [constrainPos, intent])

  /** 拖拽开始：记录起点，捕获指针。 */
  const onPointerDown = useCallback((event: React.PointerEvent) => {
    if (previewOverride !== undefined) return
    if (event.button !== 0) return
    if ((event.target as HTMLElement).closest('[role=menu]') !== null) return
    dragStart.current = { x: event.clientX, y: event.clientY, left: pos.left, top: pos.top, pointerId: event.pointerId, moved: false, next: null }
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
      setDragging(true)
      setContextMenu(null)
    }
    const next = constrainPos({ left: start.left + dx, top: start.top + dy })
    start.next = next
    setPos(next)
  }, [constrainPos])

  /** 拖拽结束：把这次拖动的位置提交为用户意图位置。 */
  const onPointerUp = useCallback((event: React.PointerEvent) => {
    const start = dragStart.current
    if (start === null) return
    dragStart.current = null
    setDragging(false)
    if ((event.currentTarget as HTMLElement).hasPointerCapture(event.pointerId)) {
      ;(event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId)
    }
    if (start.next !== null) commitPos(start.next)
  }, [commitPos])

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
      { transform: strong ? 'translate3d(-2px,3px,0) scale(.955)' : 'translate3d(0,2px,0) scale(.978)', offset: .22 },
      { transform: strong ? 'translate3d(2px,-1px,0) scale(1.025)' : 'translate3d(0,-1px,0) scale(1.012)', offset: .55 },
      { transform: 'translate3d(0,0,0) scale(1)' },
    ], { duration: strong ? 620 : 440, easing: 'cubic-bezier(.2,.86,.25,1)', fill: 'forwards' })
  }, [])

  /**
   * 血条受击抖动：位移与时长都由扣血倍率给出，掉得多就抖得更狠更久。
   * 抖动放在血条容器上，与鲸鱼娘受击、数字回弹同一帧发生，冲击感才对得起来。
   */
  const pulseHealthBar = useCallback((color: 'red' | 'green', magnitude: number) => {
    const node = healthBarRef.current
    if (magnitude <= 0) return
    if (node === null || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const visuals = damageVisuals(magnitude)
    // 回血是好事，抖动收窄成轻快的一下，不跟扣血一样砸。
    const amplitude = color === 'green' ? 1.4 : visuals.shakeAmplitude
    const duration = color === 'green' ? 240 : visuals.shakeDuration
    node.animate([
      { transform: 'translate3d(0,0,0)' },
      { transform: `translate3d(${String(-amplitude)}px,0,0)`, offset: .12 },
      { transform: `translate3d(${String(amplitude)}px,0,0)`, offset: .3 },
      { transform: `translate3d(${String(-amplitude * .55)}px,0,0)`, offset: .5 },
      { transform: `translate3d(${String(amplitude * .35)}px,0,0)`, offset: .7 },
      { transform: 'translate3d(0,0,0)' },
    ], { duration, easing: 'ease-out' })
  }, [])

  /** 将一条反馈真正发射到共同轨道。 */
  const emit = useCallback((pending: PendingFloat) => {
    const { eventId, seq, text, color, kind, label, debit, amount, suppressWhaleReaction = false } = pending
    const id = ++animId.current
    // 特效强度只看这一笔掉了多少（占血条的比例用当前的满血值算），再按用户档位缩放；
    // 「掉得多 → 特效更重」对任何满血值与档位组合都成立。
    const effectLevel = settingsRef.current?.settings.damageEffectLevel ?? DEFAULT_TOKEN_MONITOR_SETTINGS.damageEffectLevel
    const magnitude = applyEffectLevel(
      damageMagnitude(kind, amount ?? debit, (amount ?? debit ?? 0) / resolveHealthMax(settingsRef.current)),
      effectLevel,
    )
    const next = {
      eventId,
      text,
      color,
      damageKind: kind,
      magnitude,
      ...(seq === undefined ? {} : { seq }),
      ...(label === undefined ? {} : { label }),
    }
    setAnims((list) => [...list, { id, ...next }].slice(-MAX_ACTIVE_FLOATS))
    // 显示值只由接口快照校准 + 逐条扣减动画组成；不再把 "尚未发射的扣费" 加回快照，
    // 否则发射管线一旦中断，快照的下降会被待发射金额原样抵消，数字被永久钉死。
    if (debit !== undefined && debit > 0) setDisplay((previous) => applyDebitToDisplay(previous, debit))
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
      setWhaleImpactPulse((pulse) => pulse + 1)
      if (whalePoseTimer.current !== undefined) clearTimeout(whalePoseTimer.current)
      whalePoseTimer.current = setTimeout(() => {
        whalePoseTimer.current = undefined
        activeWhaleSeverity.current = 0
        setWhalePose('idle')
      }, WHALE_POSE_MS)
    }
    setFlash(color)
    pulseBalance(kind)
    // 关闭档不产生任何受击特效：抖动、冲击环、火花、闪白统统跳过，
    // 飘字与血条扣减照旧——那是信息，不是特效。
    pulseHealthBar(color, magnitude)
    if (magnitude > 0) {
      // 受击特效层靠 key 变化重播；连续扣费时直接换 key，不排队也不丢帧。
      setHitBurst({ id: ++burstId.current, color, magnitude })
      if (burstTimer.current !== undefined) clearTimeout(burstTimer.current)
      burstTimer.current = setTimeout(() => {
        burstTimer.current = undefined
        setHitBurst(null)
      }, BURST_MS)
    }
    if (flashTimer.current !== undefined) clearTimeout(flashTimer.current)
    flashTimer.current = setTimeout(() => setFlash(null), FLASH_MS)
    const timer = setTimeout(() => {
      animTimers.current.delete(timer)
      setAnims((list) => list.filter((anim) => anim.id !== id))
    }, FLOAT_MS)
    animTimers.current.add(timer)
  }, [pulseBalance, pulseHealthBar])

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
    options: TriggerOptions = {},
  ) => {
    const { label, seq, debit, amount, suppressWhaleReaction = false } = options
    animQueue.current.push({
      eventId,
      text,
      color,
      kind,
      ...(seq === undefined ? {} : { seq }),
      ...(label === undefined ? {} : { label }),
      ...(debit === undefined ? {} : { debit }),
      ...(amount === undefined ? {} : { amount }),
      ...(suppressWhaleReaction ? { suppressWhaleReaction } : {}),
    })
    // 队列非空且没有在跑的发射链就启动，避免残留的定时器 id 让后续反馈永远排不出去。
    if (queueTimer.current === undefined && animQueue.current.length > 0) drainQueue()
  }, [drainQueue])

  useEffect(() => () => {
    if (flashTimer.current !== undefined) clearTimeout(flashTimer.current)
    if (burstTimer.current !== undefined) clearTimeout(burstTimer.current)
    if (queueTimer.current !== undefined) {
      clearTimeout(queueTimer.current)
      queueTimer.current = undefined
    }
    animTimers.current.forEach((timer) => clearTimeout(timer))
    animTimers.current.clear()
    animQueue.current = []
    if (whalePoseTimer.current !== undefined) clearTimeout(whalePoseTimer.current)
  }, [])

  const cancelDrag = useCallback(() => {
    const start = dragStart.current
    if (start === null) return
    dragStart.current = null
    setDragging(false)
    // 指针在卡片之外结束：提交已拖到的位置，不回退也不写回 clamp 结果。
    if (start.next !== null) commitPos(start.next)
  }, [commitPos])

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

  // 扣费轮询：每秒增量拉取；严格按 seq 逐事件入队，不按类型聚合或重排。
  useEffect(() => {
    if (!shouldPoll) return
    let cancelled = false
    const poll = async () => {
      try {
        const res = await fetch(`/api/token-monitor/charge-events?since=${chargeSeq.current}`, { cache: 'no-store' })
        if (!res.ok) return
        const data = (await res.json()) as {
          streamId?: string
          seq: number
          firstSeq?: number
          dropped?: boolean
          events: RawChargeEvent[]
        }
        const streamChanged = chargeStreamId.current !== undefined && data.streamId !== chargeStreamId.current
        const seqRegressed = Number.isSafeInteger(data.seq) && data.seq < chargeSeq.current
        const gapDetected = data.dropped === true || (Number.isSafeInteger(data.firstSeq) && chargeSeq.current < (data.firstSeq as number) - 1)
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
            const balanceRes = await fetch('/api/token-monitor/balance', { cache: 'no-store' })
            if (balanceRes.ok) {
              const balance = (await balanceRes.json()) as BalanceInfo | null
              if (!cancelled && balance !== null) {
                setBalanceInfo(balance)
                lastBalanceSnapshot.current = balance.totalBalance
                setDisplay(balance.totalBalance)
              }
            }
          } catch {
            // 校准失败时由常规余额轮询重试。
          }
          return
        }
        const events = [...(data.events ?? [])]
          .filter((event) => Number.isFinite(event.seq) && event.seq > chargeSeq.current)
          .sort((left, right) => left.seq - right.seq)
        if (events.length === 0) return
        if (cancelled) return
        for (const event of events) {
          // 游标先推进再做飘字/动画：视觉管线抛错时不能让客户端下一轮重复拉取
          // 并重复扣减同一条扣费（原实现把该赋值放在视觉处理之后，异常会被下面的
          // catch 吞掉，游标停在原地，于是每秒重放整本账）。
          chargeSeq.current = Math.max(chargeSeq.current, event.seq)
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
            if ([hit, output, miss].every((cost) => Number.isFinite(cost) && cost >= 0) && hit + output + miss > 0) {
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
            trigger(`${eventId}-${part.suffix}`, `-${fmtCost(part.cost)}¥`, 'red', part.kind, {
              label: part.label,
              seq: event.seq,
              debit: part.cost,
              amount: part.cost,
            })
          }
        }
      } catch {
        // 扣费轮询失败静默（不影响余额显示）。
      }
    }
    void poll()
    const timer = setInterval(() => void poll(), CHARGE_POLL_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [shouldPoll, trigger])

  // 余额轮询：每 60 秒校准显示余额，检测充值（余额变多）触发绿色动画。
  useEffect(() => {
    if (!shouldPoll) return
    let cancelled = false
    const poll = async () => {
      try {
        const res = await fetch('/api/token-monitor/balance', { cache: 'no-store' })
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
          const grew = previousSnapshot !== null && data.totalBalance > previousSnapshot + 1e-9
          const crossedFromDepleted = previousSnapshot !== null && previousSnapshot <= 0 && data.totalBalance > 0
          // 先落权威快照与显示值，再做充值动画：视觉管线抛错不能连校准一起带走。
          lastBalanceSnapshot.current = data.totalBalance
          setDisplay(data.totalBalance)
          if (grew) {
            trigger(
              `heal-${Date.now()}`,
              `+${fmtCost(data.totalBalance - previousSnapshot)}¥`,
              'green',
              'normal',
              {
                // 充值额同时决定回血特效的强度：充得多，回血也更明显。
                amount: data.totalBalance - previousSnapshot,
                suppressWhaleReaction: crossedFromDepleted,
              },
            )
          }
          if (crossedFromDepleted && showWhaleGirlRef.current) {
            if (whalePoseTimer.current !== undefined) clearTimeout(whalePoseTimer.current)
            whalePoseTimer.current = undefined
            activeWhaleSeverity.current = 0
            revivingRef.current = true
            setReviving(true)
            setWhalePose('revive-recharge')
          } else if (data.totalBalance <= 0) {
            if (whalePoseTimer.current !== undefined) clearTimeout(whalePoseTimer.current)
            whalePoseTimer.current = undefined
            revivingRef.current = false
            setReviving(false)
            setWhalePose('idle')
          }
        }
      } catch {
        if (!cancelled) setError(true)
      }
    }
    void poll()
    const timer = setInterval(() => void poll(), BALANCE_POLL_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [shouldPoll, trigger])

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
    if (settingsRef.current?.settings.whaleBubbleEnabled === false) return
    setNotificationBubble(notificationText(result.item))
    if (notificationBubbleTimer.current !== undefined) clearTimeout(notificationBubbleTimer.current)
    notificationBubbleTimer.current = setTimeout(() => {
      notificationBubbleTimer.current = undefined
      setNotificationBubble(undefined)
    }, 4_000)
  }, [])

  useEffect(() => {
    if (!shouldPoll) return
    const timer = setInterval(consumeNotification, 250)
    return () => clearInterval(timer)
  }, [consumeNotification, shouldPoll])

  useEffect(() => () => {
    if (settingsNoticeTimer.current !== undefined) clearTimeout(settingsNoticeTimer.current)
  }, [])

  useEffect(() => {
    if (!shouldPoll) return
    let cancelled = false
    const poll = async () => {
      const result = await notificationEventsApi.poll(notificationQueueRef.current.cursor)
      if (cancelled || !result.ok) return
      if (!notificationSeeded.current) {
        notificationSeeded.current = true
        notificationQueueRef.current = {
          ...notificationQueueRef.current,
          cursor: { streamId: result.batch.streamId, seq: result.batch.seq },
        }
        return
      }
      const update = applyNotificationPollResult(notificationQueueRef.current, result, Date.now())
      notificationQueueRef.current = update.state
      consumeNotification()
    }
    void poll()
    const timer = setInterval(() => void poll(), 1_000)
    return () => {
      cancelled = true
      clearInterval(timer)
      if (notificationBubbleTimer.current !== undefined) clearTimeout(notificationBubbleTimer.current)
    }
  }, [consumeNotification, shouldPoll])

  if (previewOverride === undefined && routeEligible === false) return null
  // 余额模式保持原来的加载期隐藏；今日花费来自本地 usage.jsonl，不能被远端余额接口阻断。
  if (balanceInfo === undefined && !error) return null

  const amountColor = flash === 'red' ? RED : flash === 'green' ? GREEN : 'var(--dsh-color-accent, #4c8dff)'
  const balanceAvailable = balanceInfo !== undefined && balanceInfo !== null && !error
  const shownBalance = display ?? balanceInfo?.totalBalance ?? 0
  const depleted = balanceAvailable && shownBalance <= 0
  // 满血值来自设置；设置尚未到达或不可用时回落到共享默认值，血条先按 100 元满格渲染。
  const healthMax = resolveHealthMax(settingsSnapshot)
  // 配色同样以 Host 快照为准；设置未到达时按默认红色渲染，菜单选中态也据此回填。
  const healthBarColor = settingsSnapshot?.settings.healthBarColor ?? DEFAULT_TOKEN_MONITOR_SETTINGS.healthBarColor
  const palette = healthBarPalette(healthBarColor)
  // 特效档位同样以 Host 快照为准，菜单选中态据此回填。
  const damageEffectLevel = settingsSnapshot?.settings.damageEffectLevel ?? DEFAULT_TOKEN_MONITOR_SETTINGS.damageEffectLevel
  // 本次受击特效的全部尺寸都由倍率推出，扣血多少 → 特效多重只有一处定义。
  const burstVisuals = damageVisuals(hitBurst?.magnitude ?? MIN_MAGNITUDE)
  // 透支（负数余额）按空血显示；超过满血值时血条封顶，数字仍显示真实余额。
  const healthRatio = balanceAvailable ? clamp(shownBalance / healthMax, 0, 1) : 0
  // 百分比先取两位小数再进 DOM：ratio * 100 会带出 7.000000000000001 这类浮点尾数。
  const healthPercent = Math.round(healthRatio * 10_000) / 100
  const healthCritical = balanceAvailable && !depleted && healthRatio <= HEALTH_CRITICAL_RATIO
  // 只在能取到余额时才渲染血条，因此这里只有三种可呈现的状态。
  const healthState = depleted ? 'empty' : healthCritical ? 'critical' : healthRatio > 0.5 ? 'healthy' : 'low'
  const healthLabel = balanceAvailable
    ? `${balanceInfo.currency} ${shownBalance.toFixed(2)} / ${healthMax.toFixed(2)}`
    : ''
  const onWhalePoseComplete = (completedPose: WhalePose) => {
    if (completedPose !== 'revive-recharge' || !revivingRef.current) return
    revivingRef.current = false
    setReviving(false)
    setWhalePose('idle')
  }
  const cardElement = (
    <div
      ref={cardRef}
      style={{ ...CARD, left: pos.left, top: pos.top, cursor: previewOverride === undefined ? (dragging ? 'grabbing' : 'grab') : 'default' }}
      data-token-monitor-balance=""
      data-showcase-instance={previewOverride?.instanceId}
      data-showcase-peak={isPeak ? 'peak' : 'valley'}
      title="DeepSeek 账户余额血条（满血值可在详细设置里调整；扣费实时、余额 60s 校准；可拖动）"
      tabIndex={0}
      onContextMenu={onContextMenu}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={cancelDrag}
      onLostPointerCapture={cancelDrag}
    >
      <style>{KEYFRAMES}</style>
      {contextMenu !== null && (
        <div
          ref={contextMenuRef}
          role="menu"
          aria-label="余额显示设置"
          onPointerDown={(event) => event.stopPropagation()}
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
            minWidth: 200,
            padding: 6,
            borderRadius: 6,
            background: 'var(--dsh-color-surface-overlay, rgba(28, 28, 28, 0.96))',
            color: 'var(--dsh-color-text, #e8e8e8)',
            boxShadow: '0 6px 20px rgba(0,0,0,0.35)',
            border: '1px solid rgba(255,255,255,0.12)',
            zIndex: 1100,
          }}
        >
          <div style={{ padding: '2px 8px 5px', fontSize: 11, opacity: 0.65 }}>余额显示设置</div>
          <button
            type="button"
            role="menuitemcheckbox"
            aria-checked={showWhaleGirl}
            onClick={toggleWhaleGirl}
            style={{
              display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '6px 8px',
              border: 0, borderRadius: 4, background: 'transparent', color: 'inherit',
              textAlign: 'left', cursor: 'pointer', font: 'inherit',
            }}
            onMouseEnter={(event) => { event.currentTarget.style.background = 'rgba(255,255,255,0.10)' }}
            onMouseLeave={(event) => { event.currentTarget.style.background = 'transparent' }}
          >
            <span aria-hidden="true" style={{ width: 14, textAlign: 'center', color: '#79b8ff' }}>{showWhaleGirl ? '✓' : ''}</span>
            <span>显示鲸鱼娘</span>
          </button>
          <div style={{ padding: '4px 8px 5px', fontSize: 11, opacity: 0.65 }}>血条颜色</div>
          <div
            role="group"
            aria-label="血条颜色"
            style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: '0 8px 6px' }}
          >
            {HEALTH_BAR_PALETTES.map((entry) => {
              const active = entry.id === healthBarColor
              return (
                <button
                  key={entry.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={active}
                  aria-label={`血条颜色：${entry.label}`}
                  title={entry.label}
                  data-health-color-option={entry.id}
                  onClick={() => { chooseHealthBarColor(entry.id) }}
                  style={{
                    width: 20,
                    height: 20,
                    padding: 0,
                    borderRadius: '50%',
                    border: active ? '2px solid #fff' : '1px solid rgba(255,255,255,0.35)',
                    background: entry.fill,
                    boxShadow: active ? `0 0 8px ${entry.glow}` : 'none',
                    cursor: 'pointer',
                  }}
                />
              )
            })}
          </div>
          <div style={{ padding: '4px 8px 5px', fontSize: 11, opacity: 0.65 }}>扣血特效</div>
          <div
            role="radiogroup"
            aria-label="扣血特效强度"
            style={{ display: 'flex', gap: 3, padding: '0 8px 6px' }}
          >
            {TOKEN_MONITOR_DAMAGE_EFFECT_LEVELS.map((level) => {
              const active = level === damageEffectLevel
              return (
                <button
                  key={level}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  aria-label={`扣血特效强度：${DAMAGE_EFFECT_LABELS[level]}`}
                  title={DAMAGE_EFFECT_LABELS[level]}
                  data-damage-effect-option={level}
                  onClick={() => { chooseDamageEffectLevel(level) }}
                  style={{
                    flex: '1 1 0',
                    minWidth: 0,
                    padding: '3px 0',
                    fontSize: 11,
                    font: 'inherit',
                    borderRadius: 6,
                    border: active ? '1px solid #79b8ff' : '1px solid rgba(255,255,255,0.2)',
                    background: active ? 'rgba(121,184,255,0.24)' : 'transparent',
                    color: 'inherit',
                    cursor: 'pointer',
                  }}
                >
                  {DAMAGE_EFFECT_LABELS[level]}
                </button>
              )
            })}
          </div>
          <button
            type="button"
            role="menuitem"
            onClick={() => { void openSettings() }}
            style={{
              display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '6px 8px',
              border: 0, borderRadius: 4, background: 'transparent', color: 'inherit',
              textAlign: 'left', cursor: 'pointer', font: 'inherit',
            }}
            onMouseEnter={(event) => { event.currentTarget.style.background = 'rgba(255,255,255,0.10)' }}
            onMouseLeave={(event) => { event.currentTarget.style.background = 'transparent' }}
          >
            <span aria-hidden="true" style={{ width: 14, textAlign: 'center', color: '#79b8ff' }}>⚙</span>
            <span>详细设置</span>
          </button>
        </div>
      )}
      {settingsOpen && (
        <div
          role="dialog"
          aria-label="Token Monitor 详细设置"
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
              <TokenMonitorSettingsPanel
                snapshot={settingsSnapshot}
                onSave={saveSettings}
                onClose={() => setSettingsOpen(false)}
                wechatApi={wechatConnectionApi}
              />
            )}
        </div>
      )}
      {showWhaleGirl && balanceAvailable && depleted && !reviving && (
      <div
        aria-hidden="true"
        data-token-monitor-whale-depleted=""
        style={{
          position: 'absolute',
          left: '10%',
          bottom: 'calc(100% - 8px)',
          width: '80%',
          aspectRatio: '1351 / 691',
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
      {showWhaleGirl && balanceAvailable && (reviving || !depleted) && (
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            left: '10%',
            bottom: 'calc(100% - 8px)',
            width: '80%',
            aspectRatio: '1 / 1',
            zIndex: 2,
            pointerEvents: 'none',
            overflow: 'visible',
          }}
          data-token-monitor-whale-layer=""
          data-token-monitor-whale-pose={whalePose}
        >
          <WhaleGirlStage
            pose={whalePose}
            impactPulse={whaleImpactPulse}
            onPoseComplete={onWhalePoseComplete}
            {...(previewOverride?.syncEpoch === undefined ? {} : { syncEpoch: previewOverride.syncEpoch })}
          />
        </div>
      )}
      {anims.length > 0 && balanceAvailable && !depleted && (
        <div
          aria-hidden="true"
          data-token-monitor-damage-layer="head-front"
          style={{
            position: 'absolute',
            left: '50%',
            bottom: showWhaleGirl ? 'calc(100% + 42px)' : 'calc(100% + 8px)',
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
                fontSize: damageVisuals(anim.magnitude).floatFontSize,
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
                  fontSize: 11,
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
      {notificationBubble !== undefined && showWhaleGirl && balanceAvailable && !depleted && (
        <div
          role="status"
          aria-live="polite"
          data-token-monitor-notification-bubble=""
          style={{
            position: 'absolute',
            right: 0,
            top: 'calc(100% + 8px)',
            maxWidth: 260,
            transform: 'none',
            zIndex: 5,
            pointerEvents: 'none',
            padding: '7px 11px',
            borderRadius: 12,
            background: 'rgba(255,255,255,0.96)',
            color: '#3b3150',
            border: '1px solid rgba(128, 101, 215, 0.24)',
            boxShadow: '0 7px 20px rgba(42, 27, 69, 0.18)',
            fontSize: 12,
            lineHeight: 1.35,
            textAlign: 'center',
            whiteSpace: 'normal',
          }}
        >
          {notificationBubble}
        </div>
      )}
      {settingsNotice !== undefined && (
        <div
          role="status"
          aria-live="polite"
          data-token-monitor-settings-notice=""
          style={{
            position: 'absolute',
            right: 0,
            top: 'calc(100% + 8px)',
            maxWidth: 260,
            transform: 'none',
            zIndex: 5,
            pointerEvents: 'none',
            padding: '7px 11px',
            borderRadius: 12,
            background: 'rgba(255,255,255,0.96)',
            color: '#a13a3a',
            border: '1px solid rgba(196, 78, 78, 0.32)',
            boxShadow: '0 7px 20px rgba(42, 27, 69, 0.18)',
            fontSize: 12,
            lineHeight: 1.35,
            textAlign: 'center',
            whiteSpace: 'normal',
          }}
        >
          {settingsNotice}
        </div>
      )}
      <div
        style={{ position: 'relative', zIndex: 4, display: 'flex', flexDirection: 'column', gap: 5, alignItems: 'stretch' }}
        data-token-monitor-display=""
      >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      {'余额'}{' '}
      <span
        style={{
          position: 'relative',
          display: 'inline-block',
        }}
      >
        <span
          ref={balanceValueRef}
          style={{
            fontWeight: 700,
            fontVariantNumeric: 'tabular-nums',
            display: 'inline-block',
            color: amountColor,
            transition: 'color 0.25s ease',
            transform: 'translate3d(0,0,0) scale(1)',
            willChange: 'transform',
          }}
        >
          {balanceAvailable
            ? <>{balanceInfo.currency} {shownBalance.toFixed(2)}{' / '}{healthMax.toFixed(2)}</>
            : <>未配置 API Key 或查询失败</>}
        </span>
      </span>
      <span
        style={{
          fontWeight: 700,
          marginLeft: 'auto',
          color: isPeak ? RED : GREEN,
          textShadow: isPeak
            ? '0 0 6px rgba(255,59,48,0.9), 0 0 14px rgba(255,59,48,0.55)'
            : '0 0 6px rgba(48,164,108,0.9), 0 0 14px rgba(48,164,108,0.55)',
          transition: 'color 0.3s ease, text-shadow 0.3s ease',
        }}
      >
        {isPeak ? '峰' : '谷'}
      </span>
      </div>
      {balanceAvailable && (
        // 外层不裁剪，受击冲击环与火花才能炸出血条之外；内层才是被裁剪的血条本体。
        // 抖动加在外层，特效与血条同帧位移。
        <div ref={healthBarRef} style={{ position: 'relative', width: '100%' }}>
        <div
          data-token-monitor-health-bar=""
          data-health-state={healthState}
          data-health-color={palette.id}
          data-health-ratio={healthRatio.toFixed(4)}
          role="progressbar"
          aria-label="余额血条"
          aria-valuemin={0}
          aria-valuemax={healthMax}
          aria-valuenow={clamp(shownBalance, 0, healthMax)}
          aria-valuetext={healthLabel}
          style={{
            position: 'relative',
            width: '100%',
            height: HEALTH_BAR_HEIGHT,
            borderRadius: HEALTH_BAR_HEIGHT / 2,
            border: '1px solid rgba(255,255,255,0.16)',
            background: 'rgba(8, 10, 16, 0.72)',
            boxShadow: `inset 0 1px 3px rgba(0,0,0,0.55), 0 0 6px ${palette.glow}`,
            overflow: 'hidden',
            ...(healthCritical ? { animation: 'tkm-health-critical 1.5s ease-in-out infinite' } : {}),
          }}
        >
          {/* 延迟残影：同一进度但过渡晚 220ms，于是被扣掉的那一段先亮着再被追平。 */}
          <div
            aria-hidden="true"
            data-health-trail=""
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              bottom: 0,
              width: `${String(healthPercent)}%`,
              background: palette.trail,
              opacity: 0.85,
              transition: 'width 520ms cubic-bezier(.2,.8,.2,1) 220ms',
            }}
          />
          <div
            data-health-fill=""
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              bottom: 0,
              width: `${String(healthPercent)}%`,
              background: palette.fill,
              boxShadow: `0 0 9px ${palette.glow}`,
              transition: 'width 480ms cubic-bezier(.2,.8,.2,1)',
            }}
          />
          <div aria-hidden="true" style={HEALTH_BAR_TICKS} />
          <div
            aria-hidden="true"
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              top: 0,
              height: '46%',
              background: 'linear-gradient(180deg, rgba(255,255,255,0.32), rgba(255,255,255,0))',
              pointerEvents: 'none',
            }}
          />
          {/* 整条闪白：颜色取自 flash，是否存在与多亮取自受击层。
              两者分开是必要的——关闭档下 flash 仍会亮（数字要变色），但受击层不存在，
              所以这里以 hitBurst 为准，否则关闭档还会闪一下整条。 */}
          <div
            aria-hidden="true"
            data-health-screen-flash={flash ?? 'none'}
            style={{
              position: 'absolute',
              inset: 0,
              pointerEvents: 'none',
              opacity: hitBurst === null ? 0 : burstVisuals.flashOpacity,
              background: flash === 'green' ? 'rgba(150,255,196,0.85)' : '#fff',
              transition: 'opacity 150ms ease-out',
            }}
          />
          {/* 扣费闪光落在血条前沿（正在退去的那一格），充值则在新回血的边缘亮起。 */}
          <div
            aria-hidden="true"
            data-health-flash={flash ?? 'none'}
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              left: `${String(healthPercent)}%`,
              width: 14,
              marginLeft: -14,
              pointerEvents: 'none',
              opacity: flash === null ? 0 : 1,
              background: flash === 'green'
                ? 'linear-gradient(90deg, rgba(126,255,178,0) 0%, rgba(126,255,178,0.92) 100%)'
                : 'linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.9) 100%)',
              transition: 'opacity 160ms ease-out, left 480ms cubic-bezier(.2,.8,.2,1)',
            }}
          />
        </div>
        {hitBurst !== null && (
          <div
            key={hitBurst.id}
            aria-hidden="true"
            data-health-burst={hitBurst.color}
            data-health-burst-magnitude={hitBurst.magnitude.toFixed(2)}
            style={{
              position: 'absolute',
              left: `${String(healthPercent)}%`,
              top: '50%',
              width: 0,
              height: 0,
              zIndex: 3,
              pointerEvents: 'none',
              overflow: 'visible',
            }}
          >
            {/* 冲击环：直径随扣血倍率增长 */}
            <span
              style={{
                position: 'absolute',
                left: 0,
                top: 0,
                width: burstVisuals.ringSize,
                height: burstVisuals.ringSize,
                border: `2px solid ${hitBurst.color === 'green' ? HEALTH_HEAL : palette.light}`,
                borderRadius: '50%',
                boxShadow: `0 0 10px ${hitBurst.color === 'green' ? 'rgba(126,255,178,0.75)' : palette.glow}`,
                animation: `tkm-health-shock ${String(BURST_MS)}ms cubic-bezier(.15,.7,.3,1) forwards`,
              }}
            />
            {/* 火花：数量、尺寸与飞散距离都随扣血倍率变化，方向由 CSS 变量给出 */}
            {sampleDirections(HEALTH_SPARKS, burstVisuals.sparkCount).map((spark, index) => {
              // 扣血向外炸开；回血整体上飘，读起来才像「涨回来」。
              const dy = hitBurst.color === 'green' ? spark.y - 14 : spark.y
              return (
                <span
                  key={index}
                  style={{
                    position: 'absolute',
                    left: 0,
                    top: 0,
                    width: burstVisuals.sparkSize,
                    height: burstVisuals.sparkSize,
                    borderRadius: '50%',
                    background: hitBurst.color === 'green' ? '#c8ffdd' : palette.light,
                    boxShadow: `0 0 6px ${hitBurst.color === 'green' ? 'rgba(126,255,178,0.9)' : palette.glow}`,
                    '--tkm-spark-x': `${String(spark.x * burstVisuals.magnitude)}px`,
                    '--tkm-spark-y': `${String(dy * burstVisuals.magnitude)}px`,
                    animation: `tkm-health-spark ${String(BURST_MS)}ms cubic-bezier(.2,.7,.35,1) forwards`,
                  } as React.CSSProperties}
                />
              )
            })}
          </div>
        )}
        </div>
      )}
      </div>
    </div>
  )

  return createPortal(cardElement, document.body)
}
