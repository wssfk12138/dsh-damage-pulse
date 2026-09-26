import { randomUUID } from 'node:crypto'

/**
 * 扣费事件环形缓冲区：collector 每次模型调用完成时记录精确扣费金额，
 * 供 Client 通过 /api/token-monitor/charge-events 增量拉取，
 * 驱动「扣血动画」与余额本地精确扣减。
 * @module dsh-token-monitor/charge
 */

/** 扣血动画类型：缓存命中走普通反馈，缓存未命中/写入走增强反馈。 */
export type DamageKind = 'normal' | 'miss'

export interface ChargeComponent {
  tokens: number
  cost: number
}

export interface ChargeBreakdown {
  cacheHit: ChargeComponent
  cacheMiss: ChargeComponent
  output: ChargeComponent
}

/** 一次模型调用的扣费事件。 */
export interface ChargeEvent {
  /** 单调递增序号，Client 用它做增量拉取游标。 */
  seq: number
  /** 本次扣费金额（元，正数），如 0.0174。 */
  cost: number
  /** 扣费发生时间（epoch ms）。 */
  timestamp: number
  /** Client 应播放的扣血动画类型。 */
  damageKind: DamageKind
  /** Immutable billing route; absent only on legacy callers. */
  provider?: string
  model?: string
  /** Originating session event identity, used to make replay handling idempotent. */
  sourceEvent?: { sessionId: string; seq: number }
  breakdown?: ChargeBreakdown
}

export interface ChargeBatch {
  streamId: string
  seq: number
  firstSeq: number
  dropped: boolean
  events: ChargeEvent[]
}

/** 环形缓冲区上限：保留最近 500 次扣费，避免长期运行无限增长。 */
const MAX_EVENTS = 500

const events: ChargeEvent[] = []
const seenSourceEvents = new Set<string>()
const seenSourceEventOrder: string[] = []
let seqCounter = 0
let streamId = randomUUID()

/** Same-version restoration cannot replay a removed module's in-memory events. */
export function resetCharges(): void {
  events.length = 0; seenSourceEvents.clear(); seenSourceEventOrder.length = 0
  seqCounter = 0; streamId = randomUUID()
}

function sourceEventKey(sourceEvent: { sessionId: string; seq: number }): string {
  return JSON.stringify([sourceEvent.sessionId, sourceEvent.seq])
}

/** 记录一次扣费（cost 为正数金额）。 */
export function recordCharge(
  cost: number,
  timestamp: number,
  damageKind: DamageKind,
  breakdown?: ChargeBreakdown,
  sourceEvent?: { sessionId: string; sourceEventSeq?: number; provider?: string; model?: string },
): void {
  const identity = sourceEvent?.sourceEventSeq === undefined
    ? undefined
    : { sessionId: sourceEvent.sessionId, seq: sourceEvent.sourceEventSeq }
  if (identity !== undefined) {
    const key = sourceEventKey(identity)
    if (seenSourceEvents.has(key)) return
    seenSourceEvents.add(key)
    seenSourceEventOrder.push(key)
    if (seenSourceEventOrder.length > 2_000) {
      const expired = seenSourceEventOrder.shift()
      if (expired !== undefined) seenSourceEvents.delete(expired)
    }
  }
  events.push({ seq: ++seqCounter, cost, timestamp, damageKind, ...(sourceEvent?.provider === undefined ? {} : { provider: sourceEvent.provider }), ...(sourceEvent?.model === undefined ? {} : { model: sourceEvent.model }), ...(identity === undefined ? {} : { sourceEvent: identity }), ...(breakdown === undefined ? {} : { breakdown }) })
  if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS)
}

/** 返回 seq 严格大于 since 的扣费事件（按 seq 升序）。 */
export function chargesSince(since: number): ChargeEvent[] {
  if (since >= seqCounter) return []
  return events.filter((event) => event.seq > since)
}

/** 当前最大 seq（Client 用它初始化拉取游标）。 */
export function currentChargeSeq(): number {
  return seqCounter
}

export function currentChargeStreamId(): string {
  return streamId
}

export function chargeBatchSince(since: number): ChargeBatch {
  const firstSeq = events[0]?.seq ?? seqCounter + 1
  return {
    streamId,
    seq: seqCounter,
    firstSeq,
    dropped: events.length > 0 && since < firstSeq - 1,
    events: chargesSince(since),
  }
}
