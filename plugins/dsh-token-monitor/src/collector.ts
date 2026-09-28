/**
 * Token 用量采集器：监听 session/event，取 assistant/message.usage 精确记账。
 * @module dsh-token-monitor/collector
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { TokenUsage } from '@deepseek-ai/dsh-llm'
import { priceUsage, type PricingTable } from './pricing.ts'
import { recordCharge } from './charge.ts'
import { isValidUsageRecord, type TokenUsageRecordData, type UsageRecord } from './types.ts'
import { UsageStorage } from './storage.ts'
import { billUsage } from './billing.ts'
import type { BillingSnapshot } from '@deepseek-ai/dsh-token-monitor-contract'

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
  billing?: BillingSnapshot,
  pricingEnabled = true,
): UsageRecord | undefined {
  const inputTokens = usage.inputTokens
  const cacheReadTokens = usage.cacheReadTokens ?? 0
  const cacheWriteTokens = usage.cacheWriteTokens ?? 0
  const outputTokens = usage.outputTokens
  const decision = !pricingEnabled || billing === undefined ? undefined : billUsage(billing, { inputTokens, cacheReadTokens, cacheWriteTokens, outputTokens }, provider, model, timestamp)
  const breakdown = !pricingEnabled ? undefined : decision ?? priceUsage(
    inputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    outputTokens,
    provider,
    model,
    timestamp,
    priceTable,
  )
  if (breakdown === undefined) {
    const empty: UsageRecord = {
      sessionId, turn, step, sourceEventSeq, timestamp, provider, model,
      inputTokens, cacheReadTokens, cacheWriteTokens, outputTokens,
      reasoningTokens: usage.reasoningTokens ?? 0,
      costInput: 0, costCache: 0, costCacheRead: 0, costCacheWrite: 0, costOutput: 0, cost: 0, peak: false,
      billingStatus: 'unpriced',
    }
    return isValidUsageRecord(empty) ? empty : undefined
  }
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
    billingStatus: 'priced',
    ...decision,
  }
  return isValidUsageRecord(record) ? record : undefined
}

/** 挂载采集器：监听 session/event，累计每次模型调用的 token 与金额。 */
export interface CollectorOptions {
  /** Checked again at persistence time so uninstall cancels captured billing rules. */
  pricingEnabled?: () => boolean
  onPersistedRecord?: (record: UsageRecord, damageKind: 'normal' | 'miss') => void
  readBilling?: () => BillingSnapshot
  /** 会话用量行的唯一写入出口；缺省时不写入，宿主兼容判定由实现方负责。 */
  appendUsageRecord?: (session: Session, record: UsageRecord) => void
}

export function attachCollector(
  ctx: Context,
  storage: UsageStorage,
  priceTable: PricingTable,
  options: CollectorOptions = {},
): void {
  const requests = new WeakMap<Session, { turn: number; step: number; billing: BillingSnapshot }>()
  ctx.on('agent/assistant-stream', ({ agent, frame }) => {
    if (frame.type === 'start') {
      const billing = options.readBilling?.()
      if (billing !== undefined) requests.set(agent.session, { turn: frame.turn, step: frame.step, billing: structuredClone(billing) })
    } else if (frame.type === 'end') {
      requests.delete(agent.session)
    }
  })
  ctx.on('session/event', (session: Session, event: SessionEvent) => {
    if (event.type !== 'assistant/message') return
    // Opening a historical session must never apply today's rules to old events.
    if (typeof session.firstLiveSeq === 'number' && event.seq < session.firstLiveSeq) return
    const usage = event.data.usage
    if (usage === undefined) return
    const source = event.data.message.source
    if (source.kind !== 'model') return
    const request = requests.get(session)
    const billing = request?.turn === event.data.turn && request.step === event.data.step
      ? request.billing : options.readBilling?.()

    const record = buildRecord(
      session.id,
      event.data.turn,
      event.data.step,
      event.seq,
      event.time,
      source.provider,
      source.model,
      usage,
      priceTable,
      billing,
      options.pricingEnabled?.() ?? true,
    )
    if (record === undefined) return
    if (storage.add(record) === undefined) return

    // 缓存未命中输入或缓存写入均按未命中处理；纯缓存读取使用普通动画。
    const damageKind = record.inputTokens > 0 || record.cacheWriteTokens > 0 ? 'miss' : 'normal'
    if (record.billingStatus === 'priced') recordCharge(record.cost, record.timestamp, damageKind, {
      cacheHit: { tokens: record.cacheReadTokens, cost: record.costCacheRead },
      cacheMiss: { tokens: record.inputTokens + record.cacheWriteTokens, cost: record.costInput + record.costCacheWrite },
      output: { tokens: record.outputTokens, cost: record.costOutput },
    }, { sessionId: record.sessionId, sourceEventSeq: event.seq, provider: record.provider, model: record.model })
    options.onPersistedRecord?.(record, damageKind)

    // 追加「单次用量」仅日志事件，供 Web Client 回放渲染单次用量行（F1）。
    // 新版 Session 禁止在事件发布期间重入；信息性记录明确允许无插件读者忽略。
    queueMicrotask(() => {
      options.appendUsageRecord?.(session, record)
    })
  })
}
