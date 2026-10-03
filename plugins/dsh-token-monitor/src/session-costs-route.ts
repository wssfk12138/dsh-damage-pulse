/**
 * 会话金额兜底：把持久账本（usage.jsonl）按会话聚合后只读暴露给界面。
 *
 * 日志已丢失用量事件的历史会话没有可重建的投影金额，界面此前只能显示为空；
 * 账本是这类会话消费的唯一留存来源。本路由只读展示，不改账本、不改投影，
 * 也不参与计费判定。
 * @module dsh-token-monitor/session-costs-route
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { createRouteGuard } from './http-trust.ts'
import type { SessionSummary } from './types.ts'
import type { DetailSession } from '@deepseek-ai/dsh-token-monitor-contract'

/** Collision evidence contains raw identities, never inferred event equivalence. */
export interface SessionIdentityConflict {
  normalizedId: string
  rawSessionIds: string[]
  reasons: Array<'normalized-id-collision' | 'duplicate-summary' | 'metadata-id-collision'>
}

/** A conflict has no trusted amount or token/call aggregate; null is not zero. */
export type LedgerSessionRow =
  | (SessionSummary & { id: string; status?: 'priced' })
  | { id: string; sessionId: string; status: 'conflict'; cost: null; lastActivity: number; conflicts: SessionIdentityConflict[];
      calls?: never; inputTokens?: never; cacheReadTokens?: never; cacheWriteTokens?: never; outputTokens?: never; totalTokens?: never }

/** 账本与宿主列表对同一会话可能带或不带 session- 前缀，统一归一化后比对。 */
export function normalizeSessionId(id: string): string {
  return id.startsWith('session-') ? id.slice('session-'.length) : id
}

/**
 * 只读聚合显式子代理祖先；整条链上已知 project 必须一致，缺失值不清除已知约束。
 * @param summaries - 原始持久账本的会话汇总，不包含合成根汇总。
 * @param sessions - 宿主的子代理分类、父会话与可选项目元数据。
 * @returns 按最近活动排序的正金额或身份冲突行，不修改输入或账本。
 */
export function summarizeLedgerSessions(
  summaries: readonly SessionSummary[],
  sessions: ReadonlyMap<string, DetailSession> = new Map(),
): LedgerSessionRow[] {
  const groups = new Map<string, SessionSummary[]>()
  for (const summary of summaries) {
    const id = normalizeSessionId(summary.sessionId)
    const group = groups.get(id) ?? []
    group.push(summary)
    groups.set(id, group)
  }
  // A host may index the very same metadata object under both spellings.
  // Distinct records sharing a normalized id are not proof of equivalence.
  const metadata = new Map<string, DetailSession[]>()
  for (const session of sessions.values()) {
    const id = normalizeSessionId(session.id)
    const group = metadata.get(id) ?? []
    if (!group.includes(session)) group.push(session)
    metadata.set(id, group)
  }
  const collisions = new Map<string, SessionIdentityConflict>()
  for (const id of new Set([...groups.keys(), ...metadata.keys()])) {
    const rows = groups.get(id) ?? []
    const records = metadata.get(id) ?? []
    const reasons: SessionIdentityConflict['reasons'] = []
    if (rows.length > 1) reasons.push(new Set(rows.map(row => row.sessionId)).size > 1 ? 'normalized-id-collision' : 'duplicate-summary')
    if (records.length > 1) reasons.push('metadata-id-collision')
    if (reasons.length === 0) continue
    collisions.set(id, { normalizedId: id, rawSessionIds: [...new Set([...rows.map(row => row.sessionId), ...records.map(row => row.id)])].sort(), reasons })
  }
  const byId = new Map<string, LedgerSessionRow>()
  const markConflict = (id: string, conflicts: readonly SessionIdentityConflict[], activity: number): void => {
    const previous = byId.get(id)
    const merged = new Map((previous?.status === 'conflict' ? previous.conflicts : []).map(conflict => [conflict.normalizedId, conflict]))
    for (const conflict of conflicts) merged.set(conflict.normalizedId, conflict)
    byId.set(id, { id, sessionId: id, status: 'conflict', cost: null,
      lastActivity: Math.max(previous?.lastActivity ?? 0, activity), conflicts: [...merged.values()].sort((a, b) => a.normalizedId.localeCompare(b.normalizedId)) })
  }
  for (const [id, rows] of groups) {
    const conflict = collisions.get(id)
    if (conflict) markConflict(id, [conflict], Math.max(...rows.map(row => row.lastActivity)))
    else byId.set(id, { ...rows[0]!, id, sessionId: id })
  }
  for (const [id, rows] of groups) {
    const roots = new Set<string>()
    const conflicts = new Map<string, SessionIdentityConflict>()
    const addCollision = (key: string): void => { const conflict = collisions.get(key); if (conflict) conflicts.set(key, conflict) }
    addCollision(id)
    const queue = (metadata.get(id) ?? []).map(session => ({ session, project: session.project }))
    const visited = new Map<DetailSession, Set<string>>()
    for (let index = 0; index < queue.length; index++) {
      const { session: current, project } = queue[index]!
      const constraints = visited.get(current) ?? new Set<string>()
      if (constraints.has(project)) continue
      constraints.add(project)
      visited.set(current, constraints)
      if (current.child !== true || !current.parent) continue
      const parentId = normalizeSessionId(current.parent)
      const parents = metadata.get(parentId) ?? []
      for (const parent of parents) {
        if (project && parent.project && project !== parent.project) continue
        addCollision(parentId)
        if (parent.child !== true) {
          if (parentId !== id) roots.add(parentId)
        } else queue.push({ session: parent, project: project || parent.project })
      }
    }
    const activity = Math.max(...rows.map(row => row.lastActivity))
    if (conflicts.size > 0) {
      markConflict(id, [...conflicts.values()], activity)
      for (const rootId of roots) markConflict(rootId, [...conflicts.values()], activity)
      continue
    }
    // Only the original unique ledger summary contributes; synthetic roots
    // never become inputs to this loop, so inherited spend is not counted twice.
    const summary = rows[0]!
    for (const rootId of roots) {
      let aggregate = byId.get(rootId)
      if (aggregate?.status === 'conflict') { aggregate.lastActivity = Math.max(aggregate.lastActivity, activity); continue }
      if (aggregate === undefined) {
        aggregate = { id: rootId, sessionId: rootId, calls: 0, inputTokens: 0, cacheReadTokens: 0,
          cacheWriteTokens: 0, outputTokens: 0, totalTokens: 0, cost: 0, lastActivity: 0 }
        byId.set(rootId, aggregate)
      }
      for (const key of ['calls', 'inputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'outputTokens', 'totalTokens', 'cost'] as const) aggregate[key] += summary[key]
      aggregate.lastActivity = Math.max(aggregate.lastActivity, activity)
    }
  }
  return [...byId.values()]
    .filter(row => row.status === 'conflict' || (Number.isFinite(row.cost) && row.cost > 0))
    .sort((left, right) => right.lastActivity - left.lastActivity)
}

/** 注册只读的会话金额兜底路由。 */
export function registerSessionCostsRoute(
  ctx: Context,
  summaries: () => readonly SessionSummary[],
  sessions: ReadonlyMap<string, DetailSession> = new Map(),
): void {
  const guard = createRouteGuard(ctx)
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/api/token-monitor/session-costs',
    handler: (req, res) => {
      if (!guard(req, res)) return
      if (req.method !== 'GET') { res.writeHead(405); res.end(); return }
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
      res.end(JSON.stringify({ updatedAt: Date.now(), sessions: summarizeLedgerSessions(summaries(), sessions) }))
    },
  }), 'token-monitor: session cost fallback route')
}
