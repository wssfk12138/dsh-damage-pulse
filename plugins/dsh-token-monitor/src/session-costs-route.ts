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

/** 兜底行：在会话摘要上补一个归一化 id，界面直接按 id 命中。 */
export interface LedgerSessionRow extends SessionSummary {
  id: string
}

/** 账本与宿主列表对同一会话可能带或不带 session- 前缀，统一归一化后比对。 */
export function normalizeSessionId(id: string): string {
  return id.startsWith('session-') ? id.slice('session-'.length) : id
}

/** 只暴露有金额的会话，避免把整本账本塞进响应；按最近活动排序。 */
export function summarizeLedgerSessions(
  summaries: readonly SessionSummary[],
  sessions: ReadonlyMap<string, DetailSession> = new Map(),
): LedgerSessionRow[] {
  const byId = new Map(summaries.map(summary => [normalizeSessionId(summary.sessionId), { ...summary }]))
  for (const summary of summaries) {
    const child = sessions.get(normalizeSessionId(summary.sessionId)) ?? sessions.get(summary.sessionId)
    if (child?.child !== true || !child.parent) continue
    const parentId = normalizeSessionId(child.parent)
    if (parentId === normalizeSessionId(summary.sessionId)) continue
    const parent = sessions.get(parentId) ?? sessions.get(child.parent)
    if (parent === undefined || parent.child === true || (child.project && parent.project && child.project !== parent.project)) continue
    const aggregate = byId.get(parentId)
    if (aggregate === undefined) continue
    for (const key of ['calls', 'inputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'outputTokens', 'totalTokens', 'cost'] as const) {
      aggregate[key] += summary[key]
    }
    aggregate.lastActivity = Math.max(aggregate.lastActivity, summary.lastActivity)
  }
  return [...byId.values()]
    .filter(summary => typeof summary.cost === 'number' && Number.isFinite(summary.cost) && summary.cost > 0)
    .map(summary => ({ ...summary, id: normalizeSessionId(summary.sessionId), sessionId: normalizeSessionId(summary.sessionId) }))
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
