/**
 * 旧宿主会话行金额兼容桥（无视觉，挂在 shell.overlay 列表末尾）。
 *
 * 目标宿主：rc.5/rc.7 等旧版 ui-workspace —— 没有 sidebar.workspaces.sessionRow.trailing
 * 席位、没有 data-session-id、没有 data-session-row-trailing-slot marker；会话行是
 *   <div role="treeitem" aria-selected=… draggable=…>
 *     <span>状态点</span> <span>标题</span> <span>相对时间</span> <span>行操作</span>
 * 本桥只在这种旧结构上，按「唯一 displayTitle」把金额节点插到标题后、时间前
 * （与旧版 apply-sidebar-integration.ps1 的落点一致）。
 *
 * 整体停用（fail-closed，出现任一条件即停止并清理）：
 * - 文档中出现 data-session-row-trailing-slot（正式席位）或带 data-session-id 的
 *   treeitem 行 → 新宿主，由正式席位渲染，本桥全部移除。
 * - 行内出现非本桥的会话金额节点（title=Session cost / 会话消费金额，或带
 *   data-dsh-token-monitor-session-cost 但无本桥标记）→ 已有原生/旧补丁能力，
 *   防双写，整体停用。
 *
 * 单行跳过（fail-closed，结构不可信即不注入）：
 * - 行不是 div treeitem 或没有 aria-selected（排除项目行/搜索行）；
 * - 标题不是行的直接子元素 span，或同一行出现多个标题匹配；
 * - 标题在会话索引中重名（不唯一）；
 * - 标题后没有可作为时间锚点的兄弟 span（空白会话行或不可信结构）。
 *
 * 幂等与清理：MutationObserver 只对缺本桥标记的行补注入；文本更新只改 textContent；
 * 卸载或停用时移除 observer、样式与全部注入节点。
 */
import { useEffect, useMemo, useRef } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId, SessionSummaryLike } from './host-contracts.ts'
import {
  formatSessionCost,
  readSessionCost,
  SESSION_COST_LEGACY_TITLE,
  SESSION_COST_MARKER,
  SESSION_COST_TITLE,
} from './sessionCost.ts'

type LegacyBridgeProps = PropsRuntime<'shell.overlay'>

/** 本桥注入节点的专属标记（用于幂等与清理，绝不能与正式席位 marker 混用）。 */
const BRIDGE_MARKER = 'data-dsh-token-monitor-legacy-session-cost'
/** 注入节点上携带的稳定会话 id（仅存在于本桥节点，行元素本身不加 data-session-id）。 */
const SESSION_ID_ATTR = 'data-dsh-token-monitor-session-id'
const STYLE_ID = 'dsh-token-monitor-legacy-session-cost-style'

/** 旧行判定：仅 div treeitem 且带 aria-selected（项目行无 aria-selected，搜索行是 button）。 */
const LEGACY_ROW_SELECTOR = 'div[role="treeitem"][aria-selected]'

/** 非本桥的既有金额能力：旧补丁 span、中文/英文 title、无本桥标记的 data 徽标。 */
const FOREIGN_COST_SELECTOR = [
  `[data-dsh-token-monitor-session-cost]:not([${BRIDGE_MARKER}])`,
  `[title="${SESSION_COST_TITLE}"]:not([${BRIDGE_MARKER}])`,
  `[title="${SESSION_COST_LEGACY_TITLE}"]:not([${BRIDGE_MARKER}])`,
].join(', ')

/**
 * 与旧版补丁一致的视觉（标题后、时间前；hover 时随行操作浮出而隐藏；
 * 仅作用于不带 data-session-id 的旧行，避免影响正式席位徽标）。
 */
const STYLE_TEXT = [
  `[${SESSION_COST_MARKER}] {`,
  '  flex: none;',
  '  margin-right: 12px;',
  '  font-size: 12px;',
  '  line-height: 20px;',
  '  color: #4176e6;',
  '  font-variant-numeric: tabular-nums;',
  '}',
  `[role="treeitem"]:not([data-session-id]):hover [${SESSION_COST_MARKER}],`,
  `[role="treeitem"]:not([data-session-id])[class*="menuOpen"] [${SESSION_COST_MARKER}] {`,
  '  display: none;',
  '}',
].join('\n')

/** 会话金额索引：按会话 id 直读 + 按唯一 displayTitle 查会话（重名标题互斥）。 */
interface SessionCostIndex {
  bySessionId: Map<SessionId, number>
  byUniqueTitle: Map<string, SessionSummaryLike>
  /** 出现重名的标题集合：匹配到这些标题的行结构可信但无法归属，按 fail-closed 跳过。 */
  ambiguousTitles: ReadonlySet<string>
}

function buildCostIndex(byId: Record<SessionId, SessionSummaryLike>): SessionCostIndex {
  const bySessionId = new Map<SessionId, number>()
  const titleCounts = new Map<string, number>()
  const ambiguousTitles = new Set<string>()
  for (const summary of Object.values(byId)) {
    const cost = readSessionCost(summary.projectionValues)
    if (cost !== undefined) bySessionId.set(summary.id, cost)
    titleCounts.set(summary.displayTitle, (titleCounts.get(summary.displayTitle) ?? 0) + 1)
  }
  const byUniqueTitle = new Map<string, SessionSummaryLike>()
  for (const summary of Object.values(byId)) {
    // 显式计数：任意 >=2 重名（含三重重名）永久排除，绝不误判唯一。
    if ((titleCounts.get(summary.displayTitle) ?? 0) === 1) {
      byUniqueTitle.set(summary.displayTitle, summary)
    } else {
      ambiguousTitles.add(summary.displayTitle)
    }
  }
  return { bySessionId, byUniqueTitle, ambiguousTitles }
}

/**
 * 行内候选标题解析：仅接受「行的直接子元素、纯文本、文本非空」的 span，
 * 且文本命中唯一标题或歧义标题集合。
 */
type TitleResolution =
  | { kind: 'ok'; title: string; span: HTMLElement }
  /** 会话索引中该标题重名（>=2 会话），无法归属。 */
  | { kind: 'ambiguous' }
  /** 同一行出现多个候选标题 span，结构不可信。 */
  | { kind: 'multi' }
  /** 无候选标题（惰性空行、本地化文本或无关 treeitem）。 */
  | { kind: 'none' }

function resolveTitle(row: Element, index: SessionCostIndex): TitleResolution {
  const matches = Array.from(row.children).filter(child =>
    child.tagName === 'SPAN'
      && Array.from(child.childNodes).every(node => node.nodeType === Node.TEXT_NODE)
      && (child.textContent ?? '').trim().length > 0
      && (index.byUniqueTitle.has((child.textContent ?? '').trim())
        || index.ambiguousTitles.has((child.textContent ?? '').trim())),
  )
  if (matches.length > 1) return { kind: 'multi' }
  if (matches.length === 0) return { kind: 'none' }
  const span = matches[0] as HTMLElement
  const text = (span.textContent ?? '').trim()
  if (index.ambiguousTitles.has(text)) return { kind: 'ambiguous' }
  if (!index.byUniqueTitle.has(text)) return { kind: 'none' }
  return { kind: 'ok', title: text, span }
}

/** 标题后的第一个直接子元素 span（旧结构 title → time → rowActions）。 */
function timeAnchorAfter(row: Element, span: Element): HTMLElement | undefined {
  const directChildren = Array.from(row.children)
  const order = directChildren.indexOf(span)
  return directChildren.slice(order + 1).find(child => child.tagName === 'SPAN') as HTMLElement | undefined
}

/**
 * 向一行已通过结构判定的旧会话行注入金额节点。判定失败返回 'noop'
 * （无金额）或 'blocked'（结构不可信，触发单次告警），绝不写坏既有 DOM。
 */
function injectIntoRow(row: Element, index: SessionCostIndex, resolution: Extract<TitleResolution, { kind: 'ok' }>): 'injected' | 'noop' | 'blocked' {
  const summary = index.byUniqueTitle.get(resolution.title)
  if (summary === undefined) return 'noop'
  const cost = index.bySessionId.get(summary.id)
  if (cost === undefined) return 'noop'
  const timeNode = timeAnchorAfter(row, resolution.span)
  if (timeNode === undefined) return 'blocked'

  const span = document.createElement('span')
  span.setAttribute(SESSION_COST_MARKER, '')
  span.setAttribute(BRIDGE_MARKER, '')
  span.setAttribute(SESSION_ID_ATTR, summary.id)
  span.setAttribute('title', SESSION_COST_TITLE)
  span.textContent = formatSessionCost(cost)
  row.insertBefore(span, timeNode)
  return 'injected'
}

/**
 * 旧宿主兼容桥组件：无视觉的控制器。挂载后立即扫描一次，并随 DOM 变更与
 * 会话索引变更重扫；新宿主或已具备金额能力时整体停用。
 * @param props - 全局 kit（useSessions）。
 * @returns 恒为 null。
 */
export function LegacySessionCostBridge({ useSessions }: LegacyBridgeProps) {
  const byId = useSessions(state => state.byId)
  const costIndex = useMemo(() => buildCostIndex(byId), [byId])
  const costIndexRef = useRef(costIndex)
  costIndexRef.current = costIndex
  const stoppedRef = useRef(false)
  const warnedRef = useRef(false)
  const styleRef = useRef<HTMLStyleElement | null>(null)
  const observerRef = useRef<MutationObserver | null>(null)
  const scanRef = useRef<() => void>(() => {})

  useEffect(() => {
    const doc = document
    stoppedRef.current = false
    warnedRef.current = false

    const observer = new MutationObserver(() => scanRef.current())
    observer.observe(doc.documentElement, { childList: true, subtree: true, characterData: true, attributes: true })
    observerRef.current = observer
    // 初次扫描先于样式注入：新宿主不会出现瞬态样式。
    scanRef.current()

    return () => {
      stoppedRef.current = true
      observer.disconnect()
      if (observerRef.current === observer) observerRef.current = null
      doc.querySelectorAll(`[${BRIDGE_MARKER}]`).forEach(node => node.remove())
      if (styleRef.current !== null) {
        styleRef.current.remove()
        styleRef.current = null
      }
    }
  }, [])

  // 会话索引变化：整组重新对账（scan 内负责刷新既有值与补注入/移除）。
  useEffect(() => {
    if (stoppedRef.current) return
    scanRef.current()
  }, [costIndex])

  // 组件级扫描：仅经由 ref 调用（观察回调与索引刷新共用），停用后不再动作。
  scanRef.current = (): void => {
    if (stoppedRef.current) return
    const doc = document
    // 新宿主能力：正式席位 marker 或带 data-session-id 的行出现即整体停用。
    if (doc.querySelector('[data-session-row-trailing-slot]') !== null
      || doc.querySelector('[role="treeitem"][data-session-id]') !== null) {
      deactivate()
      return
    }
    const index = costIndexRef.current
    let injectedAny = false
    let blocked = false
    const rows = Array.from(doc.querySelectorAll(LEGACY_ROW_SELECTOR))
    for (const row of rows) {
      // 与全局检测互补的单行防御：个别新结构行先出现时同样停用。
      if (row.hasAttribute('data-session-id')
        || row.querySelector('[data-session-row-trailing-slot]') !== null) {
        deactivate()
        return
      }
      // 已有原生/旧补丁金额能力 → 防双写，整体停用。
      if (row.querySelector(FOREIGN_COST_SELECTOR) !== null) {
        deactivate()
        return
      }
    }
    // 全量解析（含已注入行），并按 DOM 行统计标题出现次数。
    const entries = rows.map(row => ({ row, resolution: resolveTitle(row, index) }))
    const domTitleCounts = new Map<string, number>()
    for (const entry of entries) {
      if (entry.resolution.kind !== 'ok') continue
      domTitleCounts.set(entry.resolution.title, (domTitleCounts.get(entry.resolution.title) ?? 0) + 1)
    }
    for (const entry of entries) {
      const existing = entry.row.querySelector(`[${BRIDGE_MARKER}]`)
      if (existing !== null) {
        // 整组重新验证既有节点：仍唯一、sessionId 一致、金额仍在、结构可信；
        // 任一不符即移除，随后按当前解析决定是否补注入。
        const current = entry.resolution.kind === 'ok'
          ? index.byUniqueTitle.get(entry.resolution.title)
          : undefined
        const cost = current === undefined ? undefined : index.bySessionId.get(current.id)
        const valid = entry.resolution.kind === 'ok' && current !== undefined && cost !== undefined
          && (domTitleCounts.get(entry.resolution.title) ?? 0) === 1
          && existing.getAttribute(SESSION_ID_ATTR) === current.id
          && timeAnchorAfter(entry.row, entry.resolution.span) !== undefined
        if (valid) {
          const text = formatSessionCost(cost)
          if (existing.textContent !== text) existing.textContent = text
          continue
        }
        existing.remove()
        if (entry.resolution.kind === 'ambiguous' || entry.resolution.kind === 'multi') blocked = true
      }
      if (entry.resolution.kind === 'ambiguous' || entry.resolution.kind === 'multi') {
        blocked = true
        continue
      }
      if (entry.resolution.kind !== 'ok') continue
      if ((domTitleCounts.get(entry.resolution.title) ?? 0) > 1) {
        blocked = true
        continue
      }
      const outcome = injectIntoRow(entry.row, index, entry.resolution)
      if (outcome === 'injected') injectedAny = true
      if (outcome === 'blocked') blocked = true
    }
    if (injectedAny) ensureStyle()
    if (blocked && !warnedRef.current) {
      warnedRef.current = true
      // 重名标题或不可信结构无法安全注入；单次告警避免刷屏。
      console.warn('[dsh-token-monitor] 旧版侧边栏会话行结构无法可靠识别（标题重名或结构不匹配），已跳过会话金额降级注入。')
    }
  }

  /** 仅注入成功时惰性挂载样式。 */
  const ensureStyle = (): void => {
    if (styleRef.current !== null || document.getElementById(STYLE_ID) !== null) return
    const style = document.createElement('style')
    style.id = STYLE_ID
    style.textContent = STYLE_TEXT
    document.head.appendChild(style)
    styleRef.current = style
  }

  /** 整体停用：断开观察、移除全部注入节点与样式，之后不再操作。 */
  const deactivate = (): void => {
    if (stoppedRef.current) return
    stoppedRef.current = true
    observerRef.current?.disconnect()
    observerRef.current = null
    document.querySelectorAll(`[${BRIDGE_MARKER}]`).forEach(node => node.remove())
    if (styleRef.current !== null) {
      styleRef.current.remove()
      styleRef.current = null
    }
  }

  return null
}
