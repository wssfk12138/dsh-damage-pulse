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
  status?: 'priced'
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

/** Conflict evidence mirrors the host wire contract; no aggregate is trusted. */
export interface SessionIdentityConflict {
  normalizedId: string
  rawSessionIds: string[]
  reasons: Array<'normalized-id-collision' | 'duplicate-summary' | 'metadata-id-collision'>
}
export interface LedgerSessionConflict {
  id: string
  sessionId: string
  status: 'conflict'
  cost: null
  lastActivity: number
  conflicts: SessionIdentityConflict[]
}
export type LedgerSessionRow = LedgerSessionSummary | LedgerSessionConflict
export type ResolvedSessionCost = { cost: number; fromLedger: boolean; status?: 'priced' } | LedgerSessionConflict

/** Parse only at the HTTP boundary. Reject the whole malformed snapshot, not just a warning row. */
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
function nonnegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}
function identityConflict(value: unknown): value is SessionIdentityConflict {
  return record(value) && typeof value.normalizedId === 'string' && value.normalizedId.length > 0
    && Array.isArray(value.rawSessionIds) && value.rawSessionIds.length > 0
    && value.rawSessionIds.every(id => typeof id === 'string' && id.length > 0)
    && Array.isArray(value.reasons) && value.reasons.length > 0
    && value.reasons.every(reason => reason === 'normalized-id-collision' || reason === 'duplicate-summary' || reason === 'metadata-id-collision')
}
function ledgerRow(value: unknown): value is LedgerSessionRow {
  if (!record(value) || typeof value.id !== 'string' || !value.id
    || (value.sessionId !== undefined && (typeof value.sessionId !== 'string' || value.sessionId !== value.id))
    || !nonnegative(value.lastActivity)) return false
  if (value.status === 'conflict') {
    return value.cost === null && typeof value.sessionId === 'string'
      && Array.isArray(value.conflicts) && value.conflicts.length > 0 && value.conflicts.every(identityConflict)
      && ['calls', 'inputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'outputTokens', 'totalTokens'].every(key => value[key] === undefined)
  }
  return (value.status === undefined || value.status === 'priced')
    && ['cost', 'calls', 'inputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'outputTokens', 'totalTokens'].every(key => nonnegative(value[key]))
}
function parseLedgerSnapshot(value: unknown): LedgerSessionRow[] {
  if (!record(value) || !Array.isArray(value.sessions) || !value.sessions.every(ledgerRow)) {
    throw new Error('Invalid session ledger snapshot')
  }
  return value.sessions
}

/** Index a unique identity. Defensive collisions from an older/skewed host never last-win. */
export function indexLedgerSessions(sessions: readonly LedgerSessionRow[]): Map<string, LedgerSessionRow> {
  const groups = new Map<string, LedgerSessionRow[]>()
  for (const session of sessions) {
    const id = session.id || session.sessionId
    if (typeof id !== 'string' || id === '') continue
    const key = normalizeSessionId(id)
    const group = groups.get(key) ?? []
    group.push(session)
    groups.set(key, group)
  }
  const map = new Map<string, LedgerSessionRow>()
  for (const [id, rows] of groups) {
    let entry = rows[0]
    if (entry === undefined) continue
    if (rows.length > 1) {
      const conflicts = new Map<string, SessionIdentityConflict>()
      for (const row of rows) if (row.status === 'conflict') {
        for (const conflict of row.conflicts) conflicts.set(conflict.normalizedId, conflict)
      }
      const rawSessionIds = [...new Set(rows.map(row => row.id || row.sessionId || id))].sort()
      const existing = conflicts.get(id)
      conflicts.set(id, { normalizedId: id,
        rawSessionIds: [...new Set([...rawSessionIds, ...(existing?.rawSessionIds ?? [])])].sort(),
        reasons: [...new Set<SessionIdentityConflict['reasons'][number]>([
          ...(existing?.reasons ?? []), rawSessionIds.length > 1 ? 'normalized-id-collision' : 'duplicate-summary',
        ])] })
      entry = { id, sessionId: id, status: 'conflict', cost: null,
        lastActivity: Math.max(...rows.map(row => row.lastActivity)),
        conflicts: [...conflicts.values()].sort((a, b) => a.normalizedId.localeCompare(b.normalizedId)) }
    }
    if (entry.status !== 'conflict' && (!Number.isFinite(entry.cost) || entry.cost <= 0)) continue
    map.set(id, entry)
    for (const row of rows) map.set(row.id || row.sessionId || id, entry)
  }
  return map
}

/** Conflicts are always returned, including zero-cost collisions; absent/nonpositive normal rows are omitted. */
export function ledgerSessionEntry(
  map: ReadonlyMap<string, LedgerSessionRow> | undefined,
  sessionId: SessionId | string | undefined,
): LedgerSessionRow | undefined {
  if (map === undefined || sessionId === undefined) return undefined
  const entry = map.get(String(sessionId)) ?? map.get(normalizeSessionId(sessionId))
  if (entry?.status === 'conflict') return entry
  return entry !== undefined && Number.isFinite(entry.cost) && entry.cost > 0 ? entry : undefined
}

/** Numeric compatibility helper; display consumers must resolve the entry to preserve conflict state. */
export function ledgerSessionCost(
  map: ReadonlyMap<string, LedgerSessionRow> | undefined,
  sessionId: SessionId | string | undefined,
): number | undefined {
  const entry = ledgerSessionEntry(map, sessionId)
  return entry?.status === 'conflict' ? undefined : entry?.cost
}

/** Conflict overrides projection. For a trusted identity retain the existing maximum-source rule. */
export function resolveSessionCost(
  projectionCost: number | undefined,
  ledger: number | LedgerSessionRow | undefined,
): ResolvedSessionCost | undefined {
  if (typeof ledger === 'object' && ledger.status === 'conflict') return ledger
  const ledgerCost = typeof ledger === 'object' ? ledger.cost : ledger
  if (projectionCost === undefined) return ledgerCost === undefined ? undefined : { cost: ledgerCost, fromLedger: true }
  if (ledgerCost === undefined) return { cost: projectionCost, fromLedger: false }
  return ledgerCost > projectionCost ? { cost: ledgerCost, fromLedger: true } : { cost: projectionCost, fromLedger: false }
}

let loaded: { at: number; map: Map<string, LedgerSessionRow> } | undefined
let inflight: Promise<Map<string, LedgerSessionRow>> | undefined
const listeners = new Set<() => void>()

/** 拉取账本快照：一个刷新窗口内复用结果，失败时保留上一次成功的值。 */
export function loadSessionLedger(options: { force?: boolean } = {}): Promise<Map<string, LedgerSessionRow>> {
  const now = Date.now()
  if (options.force !== true && loaded !== undefined && now - loaded.at < REFRESH_MS) return Promise.resolve(loaded.map)
  if (inflight !== undefined) return inflight
  inflight = (async () => {
    try {
      const response = await fetch(SESSION_LEDGER_ROUTE, { headers: { accept: 'application/json' }, credentials: 'same-origin' })
      if (!response.ok) return loaded?.map ?? new Map<string, LedgerSessionRow>()
      const body: unknown = await response.json()
      const map = indexLedgerSessions(parseLedgerSnapshot(body))
      loaded = { at: Date.now(), map }
      for (const listener of listeners) listener()
      return map
    } catch {
      return loaded?.map ?? new Map<string, LedgerSessionRow>()
    } finally {
      inflight = undefined
    }
  })()
  return inflight
}

/** 组件订阅：挂载时拉取一次，窗口重新可见时按需刷新。 */
export function useSessionLedger(): Map<string, LedgerSessionRow> | undefined {
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
