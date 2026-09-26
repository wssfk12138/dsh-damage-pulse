/**
 * 会话金额兜底数据源：持久账本按会话聚合的只读快照。
 *
 * 会话投影按会话日志折叠；日志缺少用量事件的历史会话没有投影金额，
 * 界面此时用本快照显示真实消费。只读展示，不写账本、不参与计费。
 */
import { useEffect, useState } from 'react'
import type { SessionId } from './host-contracts.ts'

/** Host 会话金额兜底行的展示结构（与 Host 的 SessionSummary 同形）。 */
export interface LedgerSessionSummary {
  /** 归一化会话 id（Host 同时回传 sessionId，两者取其一）。 */
  id: string
  sessionId?: string
  cost: number
  calls: number
  inputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  outputTokens: number
  totalTokens: number
  lastActivity: number
}

export const SESSION_LEDGER_ROUTE = '/api/token-monitor/session-costs'
/** 兜底金额的提示：明确说明来源是持久账本而不是会话日志折叠。 */
export const LEDGER_COST_TITLE = '会话消费金额（按持久账本累计：该会话日志缺少用量事件）'
const REFRESH_MS = 60_000

/** 账本与宿主列表对同一会话可能带或不带 session- 前缀。 */
export function normalizeSessionId(id: SessionId | string): string {
  const value = String(id)
  return value.startsWith('session-') ? value.slice('session-'.length) : value
}

/** 同时登记原始键与归一化键，两种写法都能命中且互不覆盖。 */
export function indexLedgerSessions(sessions: readonly LedgerSessionSummary[]): Map<string, LedgerSessionSummary> {
  const map = new Map<string, LedgerSessionSummary>()
  for (const session of sessions) {
    if (!Number.isFinite(session.cost) || session.cost <= 0) continue
    const id = session.id || session.sessionId
    if (typeof id !== 'string' || id === '') continue
    map.set(id, session)
    map.set(normalizeSessionId(id), session)
  }
  return map
}

/** 取兜底行；缺失或非正金额返回 undefined。 */
export function ledgerSessionEntry(
  map: ReadonlyMap<string, LedgerSessionSummary> | undefined,
  sessionId: SessionId | string | undefined,
): LedgerSessionSummary | undefined {
  if (map === undefined || sessionId === undefined) return undefined
  const entry = map.get(String(sessionId)) ?? map.get(normalizeSessionId(sessionId))
  return entry !== undefined && Number.isFinite(entry.cost) && entry.cost > 0 ? entry : undefined
}

/** 取兜底金额；供会话行徽标使用。 */
export function ledgerSessionCost(
  map: ReadonlyMap<string, LedgerSessionSummary> | undefined,
  sessionId: SessionId | string | undefined,
): number | undefined {
  return ledgerSessionEntry(map, sessionId)?.cost
}

/**
 * 展示金额的来源选择：持久账本是消费的权威记录，而日志折叠可能因事件缺失而少算，
 * 因此两者都可用时取较大值；只有一个来源时用该来源。
 */
export function resolveSessionCost(
  projectionCost: number | undefined,
  ledgerCost: number | undefined,
): { cost: number; fromLedger: boolean } | undefined {
  if (projectionCost === undefined) return ledgerCost === undefined ? undefined : { cost: ledgerCost, fromLedger: true }
  if (ledgerCost === undefined) return { cost: projectionCost, fromLedger: false }
  return ledgerCost > projectionCost ? { cost: ledgerCost, fromLedger: true } : { cost: projectionCost, fromLedger: false }
}

let loaded: { at: number; map: Map<string, LedgerSessionSummary> } | undefined
let inflight: Promise<Map<string, LedgerSessionSummary>> | undefined
const listeners = new Set<() => void>()

/** 拉取账本快照：一个刷新窗口内复用结果，失败时保留上一次成功的值。 */
export function loadSessionLedger(options: { force?: boolean } = {}): Promise<Map<string, LedgerSessionSummary>> {
  const now = Date.now()
  if (options.force !== true && loaded !== undefined && now - loaded.at < REFRESH_MS) return Promise.resolve(loaded.map)
  if (inflight !== undefined) return inflight
  inflight = (async () => {
    try {
      const response = await fetch(SESSION_LEDGER_ROUTE, { headers: { accept: 'application/json' }, credentials: 'same-origin' })
      if (!response.ok) return loaded?.map ?? new Map<string, LedgerSessionSummary>()
      const body = await response.json() as { sessions?: LedgerSessionSummary[] }
      const map = indexLedgerSessions(Array.isArray(body.sessions) ? body.sessions : [])
      loaded = { at: Date.now(), map }
      for (const listener of listeners) listener()
      return map
    } catch {
      return loaded?.map ?? new Map<string, LedgerSessionSummary>()
    } finally {
      inflight = undefined
    }
  })()
  return inflight
}

/** 组件订阅：挂载时拉取一次，窗口重新可见时按需刷新。 */
export function useSessionLedger(): Map<string, LedgerSessionSummary> | undefined {
  const [value, setValue] = useState(() => loaded?.map)
  useEffect(() => {
    let active = true
    const update = () => { if (active) setValue(loaded?.map) }
    listeners.add(update)
    void loadSessionLedger().then(update)
    const onVisible = () => { if (document.visibilityState === 'visible') void loadSessionLedger({ force: true }).then(update) }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      active = false
      listeners.delete(update)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])
  return value
}
