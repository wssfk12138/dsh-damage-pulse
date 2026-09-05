/**
 * 余额悬浮卡片：挂载在 frame 级浮动层（shell.overlay，右下角）。
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
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { type TokenMonitorSettingsSnapshot, type TokenMonitorSettingsPatchRequest } from '../../../../util/token-monitor-contract/src/index.ts'
import type { RouteEligibilityLoader } from './routeEligibility.ts'
import { createTokenMonitorSettingsApi } from './settingsApi.ts'
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
  zIndex: 1000,
}

const RED = '#ff3b30'
const GREEN = '#30a46c'
const WHALE_ASSET_ROOT = '/assets/dsh-token-monitor/whale-girl'
type WhalePose = AnimatedWhalePose
const DEATH_ASSET = `${WHALE_ASSET_ROOT}/death-stranded-v6-trim.png`

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
@media (prefers-reduced-motion: reduce) {
  .tkm-impact-float {
    animation: tkm-impact-float-reduced 180ms ease-out forwards !important;
  }
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
  const [whalePose, setWhalePose] = useState<WhalePose>('idle')
  const [whaleImpactPulse, setWhaleImpactPulse] = useState(0)
  const [reviving, setReviving] = useState(false)
  const [showWhaleGirl, setShowWhaleGirl] = useState(loadWhaleVisible)
  const [settingsSnapshot, setSettingsSnapshot] = useState<TokenMonitorSettingsSnapshot>()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsError, setSettingsError] = useState<string>()
  const [notificationBubble, setNotificationBubble] = useState<string>()
  const [contextMenu, setContextMenu] = useState<{ left: number; top: number } | null>(null)
  // 悬浮窗位置（left/top），初始从 localStorage 恢复或默认右下角。
  const [pos, setPos] = useState<{ left: number; top: number }>(() => previewOverride?.fixedPosition ?? loadPos())
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
  // 权威余额已包含刚发生的扣费；尚未发射的金额要临时加回，避免轮询校准后再次扣除。
  const queuedDebit = useRef(0)
  const queueTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const whalePoseTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const lastCriticalAt = useRef(0)
  const activeWhaleSeverity = useRef(0)
  const lastBalanceSnapshot = useRef<number | null>(null)
  const revivingRef = useRef(false)
  const showWhaleGirlRef = useRef(showWhaleGirl)
  const balanceValueRef = useRef<HTMLSpanElement>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  // 拖拽起点：按下时的鼠标位置 + 卡片位置。
  const dragStart = useRef<{ x: number; y: number; left: number; top: number; pointerId: number; moved: boolean } | null>(null)
  const contextMenuRef = useRef<HTMLDivElement>(null)
  const settingsRef = useRef(settingsSnapshot)
  const notificationQueueRef = useRef(createNotificationQueueState())
  const notificationSeeded = useRef(false)
  const notificationBubbleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  /** 右键打开余额显示设置菜单，并限制菜单不超出视口。 */
  const onContextMenu = useCallback((event: React.MouseEvent) => {
    event.preventDefault()
    dragStart.current = null
    setDragging(false)
    const menuWidth = 176
    const menuHeight = 160
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

  const toggleWhaleGirl = useCallback(() => {
    setShowWhaleGirl((visible) => {
      const next = !visible
      try {
        localStorage.setItem(WHALE_VISIBLE_KEY, JSON.stringify(next))
      } catch {
        // 隐私模式等场景下无法持久化时，仍保留当前会话设置。
      }
      return next
    })
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

  /** 卡片完整约束在视口内；窗口缩放后也会修正并保存位置。 */
  const constrainPos = useCallback((next: { left: number; top: number }) => {
    const rect = cardRef.current?.getBoundingClientRect()
    const width = rect?.width ?? 180
    const height = rect?.height ?? 34
    return {
      left: clamp(next.left, 0, Math.max(0, window.innerWidth - width)),
      top: clamp(next.top, 0, Math.max(0, window.innerHeight - height)),
    }
  }, [])

  useEffect(() => {
    const onResize = () => setPos((current) => {
      const next = constrainPos(current)
      savePos(next)
      return next
    })
    window.addEventListener('resize', onResize)
    onResize()
    return () => window.removeEventListener('resize', onResize)
  }, [constrainPos])

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
      { transform: strong ? 'translate3d(-2px,3px,0) scale(.955)' : 'translate3d(0,2px,0) scale(.978)', offset: .22 },
      { transform: strong ? 'translate3d(2px,-1px,0) scale(1.025)' : 'translate3d(0,-1px,0) scale(1.012)', offset: .55 },
      { transform: 'translate3d(0,0,0) scale(1)' },
    ], { duration: strong ? 620 : 440, easing: 'cubic-bezier(.2,.86,.25,1)', fill: 'forwards' })
  }, [])

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
    setAnims((list) => [...list, { id, ...next }].slice(-MAX_ACTIVE_FLOATS))
    if (debit !== undefined && debit > 0) {
      queuedDebit.current = Math.max(0, queuedDebit.current - debit)
      setDisplay((previous) => applyDebitToDisplay(previous, debit))
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
    if (flashTimer.current !== undefined) clearTimeout(flashTimer.current)
    flashTimer.current = setTimeout(() => setFlash(null), FLASH_MS)
    const timer = setTimeout(() => {
      animTimers.current.delete(timer)
      setAnims((list) => list.filter((anim) => anim.id !== id))
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
    emit(next)
    // 保留一个完整发射间隔作为冷却窗，确保同批同步入队也会错峰。
    queueTimer.current = setTimeout(drain, FLOAT_EMIT_INTERVAL_MS)
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
    if (debit !== undefined && debit > 0) queuedDebit.current += debit
    animQueue.current.push({
      eventId,
      text,
      color,
      kind,
      ...(seq === undefined ? {} : { seq }),
      ...(label === undefined ? {} : { label }),
      ...(debit === undefined ? {} : { debit }),
      ...(suppressWhaleReaction ? { suppressWhaleReaction } : {}),
    })
    if (queueTimer.current === undefined && animQueue.current.length === 1) drainQueue()
  }, [drainQueue])

  useEffect(() => () => {
    if (flashTimer.current !== undefined) clearTimeout(flashTimer.current)
    if (queueTimer.current !== undefined) clearTimeout(queueTimer.current)
    animTimers.current.forEach((timer) => clearTimeout(timer))
    animTimers.current.clear()
    animQueue.current = []
    queuedDebit.current = 0
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
                setDisplay(balance.totalBalance + queuedDebit.current)
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
            trigger(`${eventId}-${part.suffix}`, `-${fmtCost(part.cost)}¥`, 'red', part.kind, part.label, event.seq, part.cost)
          }
          chargeSeq.current = Math.max(chargeSeq.current, event.seq)
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
          if (grew) {
            trigger(
              `heal-${Date.now()}`,
              `+${fmtCost(data.totalBalance - previousSnapshot)}¥`,
              'green',
              'normal',
              undefined,
              undefined,
              undefined,
              crossedFromDepleted,
            )
          }
          lastBalanceSnapshot.current = data.totalBalance
          setDisplay(data.totalBalance + queuedDebit.current)
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
  const onWhalePoseComplete = (completedPose: WhalePose) => {
    if (completedPose !== 'revive-recharge' || !revivingRef.current) return
    revivingRef.current = false
    setReviving(false)
    setWhalePose('idle')
  }
  return (
    <div
      ref={cardRef}
      style={{ ...CARD, left: pos.left, top: pos.top, cursor: previewOverride === undefined ? (dragging ? 'grabbing' : 'grab') : 'default' }}
      data-token-monitor-balance=""
      data-showcase-instance={previewOverride?.instanceId}
      data-showcase-peak={isPeak ? 'peak' : 'valley'}
      title="DeepSeek 账户余额（扣费实时、余额 60s 校准；可拖动）"
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
            minWidth: 176,
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
                fontSize: anim.damageKind === 'miss' ? 23 : FLOAT.fontSize,
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
      <div style={{ position: 'relative', zIndex: 4 }} data-token-monitor-display="">
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
            ? <>{balanceInfo.currency} {shownBalance.toFixed(2)}</>
            : <>未配置 API Key 或查询失败</>}
        </span>
      </span>
      <span
        style={{
          fontWeight: 700,
          marginLeft: 6,
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
    </div>
  )
}
