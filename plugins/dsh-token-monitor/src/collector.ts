/**
 * Token 用量采集器：监听 session/event，取 assistant/message.usage 精确记账。
 * @module dsh-token-monitor/collector
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { TokenUsage } from '@deepseek-ai/dsh-llm'
import { priceUsage, type PricingTable } from './pricing.ts'
import { recordCharge } from './charge.ts'
import { isValidUsageRecord, type TokenUsageRecordData, type UsageRecord } from './types.ts'
import { UsageStorage } from './storage.ts'

/** 把一条 assistant/message 的 usage 转成 UsageRecord。 */
function buildRecord(
  sessionId: string,
  turn: number,
  step: number,
  sourceEventSeq: number,
  timestamp: number,
  provider: string,
  model: string,
  usage: TokenUsage,
  priceTable: PricingTable,
): UsageRecord | undefined {
  const inputTokens = usage.inputTokens
  const cacheReadTokens = usage.cacheReadTokens ?? 0
  const cacheWriteTokens = usage.cacheWriteTokens ?? 0
  const outputTokens = usage.outputTokens
  const breakdown = priceUsage(
    inputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    outputTokens,
    provider,
    model,
    timestamp,
    priceTable,
  )
  if (breakdown === undefined) return undefined
  // 空 usage 不是可展示/可通知的扣费，在账本入口丢弃。
  if (breakdown.cost <= 0) return undefined
  const record: UsageRecord = {
    sessionId,
    turn,
    step,
    sourceEventSeq,
    timestamp,
    provider,
    model,
    inputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    outputTokens,
    reasoningTokens: usage.reasoningTokens ?? 0,
    costInput: breakdown.costInput,
    costCache: breakdown.costCache,
    costCacheRead: breakdown.costCacheRead,
    costCacheWrite: breakdown.costCacheWrite,
    costOutput: breakdown.costOutput,
    cost: breakdown.cost,
    peak: breakdown.peak,
  }
  return isValidUsageRecord(record) ? record : undefined
}

/** 挂载采集器：监听 session/event，累计每次模型调用的 token 与金额。 */
export interface CollectorOptions {
  onPersistedRecord?: (record: UsageRecord, damageKind: 'normal' | 'miss') => void
}

export function attachCollector(
  ctx: Context,
  storage: UsageStorage,
  priceTable: PricingTable | (() => PricingTable),
  options: CollectorOptions = {},
): void {
  // 价格表可传活引用：settings 提供的表要等 inject 回调才就绪，按值捕获会一直用内置表。
  const readPriceTable = typeof priceTable === 'function' ? priceTable : () => priceTable
  ctx.on('session/event', (session: Session, event: SessionEvent) => {
    if (event.type !== 'assistant/message') return
    const usage = event.data.usage
    if (usage === undefined) return
    const source = event.data.message.source
    if (source.kind !== 'model') return

    const record = buildRecord(
      session.id,
      event.data.turn,
      event.data.step,
      event.seq,
      event.time,
      source.provider,
      source.model,
      usage,
      readPriceTable(),
    )
    if (record === undefined) return
    if (storage.add(record) === undefined) return

    // 缓存未命中输入或缓存写入均按未命中处理；纯缓存读取使用普通动画。
    const damageKind = record.inputTokens > 0 || record.cacheWriteTokens > 0 ? 'miss' : 'normal'
    recordCharge(record.cost, record.timestamp, damageKind, {
      cacheHit: { tokens: record.cacheReadTokens, cost: record.costCacheRead },
      cacheMiss: { tokens: record.inputTokens + record.cacheWriteTokens, cost: record.costInput + record.costCacheWrite },
      output: { tokens: record.outputTokens, cost: record.costOutput },
    }, { sessionId: record.sessionId, sourceEventSeq: record.sourceEventSeq })
    options.onPersistedRecord?.(record, damageKind)

    // 追加「单次用量」仅日志事件，供 Web Client 回放渲染单次用量行（F1）。
    // 仅日志事件不进模型 surface，非 SurfaceEventType 只需 (type, data)。
    session.append('token-usage/record', { record } satisfies TokenUsageRecordData)
  })
}
