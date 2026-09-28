/** Permanent usage capture; optional billing is supplied by its live module. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { BillingSnapshot } from '@deepseek-ai/dsh-token-monitor-contract'
import { isValidUsageRecord, type UsageRecord } from './types.ts'
import type { UsageStorage } from './storage.ts'

export interface UsageCollectorOptions {
  readBilling?: () => BillingSnapshot | undefined
  priceRecord?: (record: UsageRecord, frozen: BillingSnapshot | undefined) => UsageRecord
  onPersistedRecord?: (record: UsageRecord, kind: 'normal' | 'miss') => void
  /** 会话用量行的唯一写入出口；缺省时不写入，宿主兼容判定由实现方负责。 */
  appendUsageRecord?: (session: Session, record: UsageRecord) => void
}

/** Capture each live source event once, even while all optional modules are absent. */
export function attachUsageCollector(ctx: Context, storage: UsageStorage, options: UsageCollectorOptions): void {
  const requests = new WeakMap<Session, { turn: number; step: number; billing: BillingSnapshot }>()
  let active = true
  ctx.effect(() => () => { active = false }, 'token-monitor: usage capture lifetime')
  ctx.on('agent/assistant-stream', ({ agent, frame }) => {
    if (frame.type === 'start') {
      const billing = options.readBilling?.()
      if (billing !== undefined) requests.set(agent.session, { turn: frame.turn, step: frame.step, billing: structuredClone(billing) })
    } else if (frame.type === 'end') requests.delete(agent.session)
  })
  ctx.on('session/event', (session: Session, event: SessionEvent) => {
    if (!active || event.type !== 'assistant/message') return
    if (typeof session.firstLiveSeq === 'number' && event.seq < session.firstLiveSeq) return
    const usage = event.data.usage, source = event.data.message.source
    if (usage === undefined || source.kind !== 'model') return
    const raw: UsageRecord = {
      sessionId: session.id, turn: event.data.turn, step: event.data.step, sourceEventSeq: event.seq,
      timestamp: event.time, provider: source.provider, model: source.model, inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens, cacheReadTokens: usage.cacheReadTokens ?? 0, cacheWriteTokens: usage.cacheWriteTokens ?? 0,
      reasoningTokens: usage.reasoningTokens ?? 0, cost: 0, costInput: 0, costOutput: 0, costCache: 0, costCacheRead: 0,
      costCacheWrite: 0, peak: false, billingStatus: 'unpriced',
    }
    if (!isValidUsageRecord(raw)) return
    const request = requests.get(session)
    const frozen = request?.turn === raw.turn && request.step === raw.step ? request.billing : options.readBilling?.()
    const record = options.priceRecord?.(raw, frozen) ?? raw
    if (!isValidUsageRecord(record) || storage.add(record) === undefined) return
    const kind = record.inputTokens > 0 || record.cacheWriteTokens > 0 ? 'miss' : 'normal'
    options.onPersistedRecord?.(record, kind)
    queueMicrotask(() => {
      if (!active) return
      options.appendUsageRecord?.(session, record)
    })
  })
}
