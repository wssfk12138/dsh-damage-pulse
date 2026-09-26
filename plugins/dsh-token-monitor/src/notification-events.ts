import { createHash, randomUUID } from 'node:crypto'
import type { BudgetThresholdCrossing } from './budget.ts'
import type { DamageKind } from './charge.ts'
import type { PeakTransition } from './peak-transition.ts'
import type { UsageRecord } from './types.ts'
import type { CacheHitAnomalyNotificationPayload } from './cache-hit-anomaly.ts'

export const TOKEN_MONITOR_NOTIFICATION_SCHEMA_VERSION = 1 as const
export const DEFAULT_NOTIFICATION_EVENT_CAPACITY = 500
export const DEFAULT_NOTIFICATION_DEDUPE_CAPACITY = 2_000
export const DEFAULT_CHARGE_COALESCE_WINDOW_MS = 1_750

export type TokenMonitorNotificationKind =
  | 'charge'
  | 'budget-threshold'
  | 'peak-enter'
  | 'peak-exit'
  | 'cache-hit-anomaly'

export type TokenMonitorNotificationPriority = 'normal' | 'high'

export interface ChargeNotificationPayload {
  cost: number
  damageKind: DamageKind
  sessionId: string
  turn: number
  step: number
  provider: string
  model: string
}

export interface BudgetThresholdNotificationPayload {
  date: string
  budget: number
  previousSpend: number
  currentSpend: number
  remaining: number
}

export interface PeakTransitionNotificationPayload {
  from: 'peak' | 'offPeak'
  to: 'peak' | 'offPeak'
  periodKey: string
}

export type { CacheHitAnomalyNotificationPayload }

interface NotificationEventBase<K extends TokenMonitorNotificationKind, P> {
  provider?: string
  model?: string
  schemaVersion: typeof TOKEN_MONITOR_NOTIFICATION_SCHEMA_VERSION
  seq: number
  id: string
  dedupeKey: string
  kind: K
  timestamp: number
  priority: TokenMonitorNotificationPriority
  payload: P
}

export type ChargeNotificationEvent = NotificationEventBase<'charge', ChargeNotificationPayload>
export type BudgetThresholdNotificationEvent = NotificationEventBase<
  'budget-threshold',
  BudgetThresholdNotificationPayload
>
export type PeakEnterNotificationEvent = NotificationEventBase<'peak-enter', PeakTransitionNotificationPayload>
export type PeakExitNotificationEvent = NotificationEventBase<'peak-exit', PeakTransitionNotificationPayload>
export type CacheHitAnomalyNotificationEvent = NotificationEventBase<'cache-hit-anomaly', CacheHitAnomalyNotificationPayload>

export type TokenMonitorNotificationEvent =
  | ChargeNotificationEvent
  | BudgetThresholdNotificationEvent
  | PeakEnterNotificationEvent
  | PeakExitNotificationEvent
  | CacheHitAnomalyNotificationEvent

export type TokenMonitorNotificationDraft =
  TokenMonitorNotificationEvent extends infer Event
    ? Event extends TokenMonitorNotificationEvent ? Omit<Event, 'seq'> : never
    : never

export interface TokenMonitorNotificationBatch {
  streamId: string
  seq: number
  events: TokenMonitorNotificationEvent[]
}

export interface NotificationEventBufferOptions {
  capacity?: number
  dedupeCapacity?: number
  streamId?: string
}

export interface CoalescedChargeNotification {
  kind: 'charge-summary'
  firstSeq: number
  lastSeq: number
  firstTimestamp: number
  lastTimestamp: number
  cost: number
  calls: number
  damageKind: DamageKind
  eventIds: string[]
  dedupeKeys: string[]
}

export type NotificationDisplayItem =
  | CoalescedChargeNotification
  | { kind: 'event'; event: Exclude<TokenMonitorNotificationEvent, ChargeNotificationEvent> }

function assertNonEmptyString(value: unknown, name: string): asserts value is string {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${name} must be a non-empty string`)
}

function assertFiniteNumber(value: unknown, name: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`${name} must be finite`)
}

function assertNonNegativeSafeInteger(value: unknown, name: string): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new TypeError(`${name} must be a non-negative safe integer`)
  }
}

function stableNotificationKey(kind: TokenMonitorNotificationKind, identity: readonly unknown[]): string {
  const digest = createHash('sha256').update(JSON.stringify(identity)).digest('hex')
  return `token-monitor-notification:v1:${kind}:${digest}`
}

function draft<K extends TokenMonitorNotificationKind, P>(
  kind: K,
  timestamp: number,
  priority: TokenMonitorNotificationPriority,
  payload: P,
  identity: readonly unknown[],
  scope?: { provider: string; model?: string },
): Omit<NotificationEventBase<K, P>, 'seq'> {
  const dedupeKey = stableNotificationKey(kind, scope ? [scope.provider, scope.model ?? null, ...identity] : identity)
  return {
    ...scope,
    schemaVersion: TOKEN_MONITOR_NOTIFICATION_SCHEMA_VERSION,
    id: dedupeKey,
    dedupeKey,
    kind,
    timestamp,
    priority,
    payload,
  }
}

/** Build exactly one bubble event for one persisted model-call record. */
export function createChargeNotification(
  record: UsageRecord,
  damageKind: DamageKind,
): TokenMonitorNotificationDraft {
  assertNonEmptyString(record.sessionId, 'record.sessionId')
  assertNonEmptyString(record.provider, 'record.provider')
  assertNonEmptyString(record.model, 'record.model')
  assertNonNegativeSafeInteger(record.turn, 'record.turn')
  assertNonNegativeSafeInteger(record.step, 'record.step')
  assertNonNegativeSafeInteger(record.timestamp, 'record.timestamp')
  assertFiniteNumber(record.cost, 'record.cost')
  if (record.cost <= 0) throw new RangeError('record.cost must be positive')
  if (damageKind !== 'normal' && damageKind !== 'miss') throw new TypeError('damageKind is invalid')

  const payload: ChargeNotificationPayload = {
    cost: record.cost,
    damageKind,
    sessionId: record.sessionId,
    turn: record.turn,
    step: record.step,
    provider: record.provider,
    model: record.model,
  }
  return draft('charge', record.timestamp, 'normal', payload, [
    record.sessionId,
    record.turn,
    record.step,
    record.sourceEventSeq ?? null,
    record.timestamp,
    record.provider,
    record.model,
    record.inputTokens,
    record.cacheReadTokens,
    record.cacheWriteTokens,
    record.outputTokens,
    record.reasoningTokens,
    record.costInput,
    record.costCache,
    record.costCacheRead,
    record.costCacheWrite,
    record.costOutput,
    record.cost,
    damageKind,
  ])
}

export function createBudgetThresholdNotification(
  crossing: BudgetThresholdCrossing,
  timestamp: number,
  provider?: string,
): TokenMonitorNotificationDraft {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(crossing.date)) throw new TypeError('crossing.date must be YYYY-MM-DD')
  assertNonNegativeSafeInteger(timestamp, 'timestamp')
  for (const [name, value] of Object.entries({
    budget: crossing.budget,
    previousSpend: crossing.previousSpend,
    currentSpend: crossing.currentSpend,
    remaining: crossing.remaining,
  })) assertFiniteNumber(value, `crossing.${name}`)
  if (crossing.budget <= 0) throw new RangeError('crossing.budget must be positive')
  if (crossing.previousSpend < 0 || crossing.currentSpend < 0) {
    throw new RangeError('crossing spend values must be non-negative')
  }
  if (!(crossing.previousSpend < crossing.budget && crossing.currentSpend >= crossing.budget)) {
    throw new RangeError('crossing must cross the configured budget')
  }

  const budgetCents = Math.round(crossing.budget * 100)
  if (!Number.isSafeInteger(budgetCents)) throw new RangeError('crossing.budget is outside the supported range')
  const payload: BudgetThresholdNotificationPayload = { ...crossing }
  return draft('budget-threshold', timestamp, 'high', payload, [crossing.date, budgetCents], provider ? { provider } : undefined)
}

export function createPeakTransitionNotification(transition: PeakTransition, provider?: string): TokenMonitorNotificationDraft {
  assertNonNegativeSafeInteger(transition.observedAt, 'transition.observedAt')
  assertNonEmptyString(transition.key, 'transition.key')
  if (transition.from === transition.to) throw new RangeError('transition must change period')
  const kind = transition.to === 'peak' ? 'peak-enter' : 'peak-exit'
  const payload: PeakTransitionNotificationPayload = {
    from: transition.from,
    to: transition.to,
    periodKey: transition.key,
  }
  return draft(kind, transition.observedAt, 'normal', payload, [transition.key], provider ? { provider } : undefined)
}

export function createCacheHitAnomalyNotification(
  payload: CacheHitAnomalyNotificationPayload,
  scope?: { provider: string; model: string },
): TokenMonitorNotificationDraft {
  assertNonNegativeSafeInteger(payload.episodeId, 'cache anomaly episodeId')
  assertFiniteNumber(payload.observedRate, 'cache anomaly observedRate')
  assertFiniteNumber(payload.threshold, 'cache anomaly threshold')
  assertNonNegativeSafeInteger(payload.sampleCount, 'cache anomaly sampleCount')
  assertNonNegativeSafeInteger(payload.consecutiveCalls, 'cache anomaly consecutiveCalls')
  assertNonNegativeSafeInteger(payload.observedAt, 'cache anomaly observedAt')
  if (payload.observedRate < 0 || payload.observedRate > 1 || payload.threshold < 0 || payload.threshold > 1) {
    throw new RangeError('cache anomaly rates must be within 0..1')
  }
  if (payload.episodeId < 1 || payload.sampleCount < 2 || payload.consecutiveCalls < 2) throw new RangeError('cache anomaly counters are invalid')
  return draft('cache-hit-anomaly', payload.observedAt, 'normal', payload, [
    payload.episodeId,
  ], scope)
}

function validateEvent(event: unknown): asserts event is TokenMonitorNotificationEvent {
  if (typeof event !== 'object' || event === null) throw new TypeError('notification event must be an object')
  const candidate = event as Record<string, unknown>
  if (candidate.provider !== undefined) assertNonEmptyString(candidate.provider, 'notification provider')
  if (candidate.model !== undefined) assertNonEmptyString(candidate.model, 'notification model')
  if (candidate.schemaVersion !== TOKEN_MONITOR_NOTIFICATION_SCHEMA_VERSION) {
    throw new TypeError('notification event schemaVersion is unsupported')
  }
  assertNonNegativeSafeInteger(candidate.seq, 'notification event seq')
  if (candidate.seq === 0) throw new RangeError('notification event seq must be positive')
  assertNonEmptyString(candidate.id, 'notification event id')
  assertNonEmptyString(candidate.dedupeKey, 'notification event dedupeKey')
  if (candidate.id !== candidate.dedupeKey) throw new TypeError('notification event id must equal dedupeKey')
  assertNonNegativeSafeInteger(candidate.timestamp, 'notification event timestamp')
  if (candidate.priority !== 'normal' && candidate.priority !== 'high') {
    throw new TypeError('notification event priority is invalid')
  }
  if (!['charge', 'budget-threshold', 'peak-enter', 'peak-exit', 'cache-hit-anomaly'].includes(String(candidate.kind))) {
    throw new TypeError('notification event kind is invalid')
  }
  if (typeof candidate.payload !== 'object' || candidate.payload === null) {
    throw new TypeError('notification event payload must be an object')
  }

  const payload = candidate.payload as Record<string, unknown>
  if (candidate.kind === 'charge') {
    assertFiniteNumber(payload.cost, 'charge payload cost')
    if (payload.cost <= 0) throw new RangeError('charge payload cost must be positive')
    if (payload.damageKind !== 'normal' && payload.damageKind !== 'miss') {
      throw new TypeError('charge payload damageKind is invalid')
    }
    assertNonEmptyString(payload.sessionId, 'charge payload sessionId')
    assertNonNegativeSafeInteger(payload.turn, 'charge payload turn')
    assertNonNegativeSafeInteger(payload.step, 'charge payload step')
    assertNonEmptyString(payload.provider, 'charge payload provider')
    assertNonEmptyString(payload.model, 'charge payload model')
    return
  }
  if (candidate.kind === 'budget-threshold') {
    if (typeof payload.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(payload.date)) {
      throw new TypeError('budget payload date must be YYYY-MM-DD')
    }
    assertFiniteNumber(payload.budget, 'budget payload budget')
    assertFiniteNumber(payload.previousSpend, 'budget payload previousSpend')
    assertFiniteNumber(payload.currentSpend, 'budget payload currentSpend')
    assertFiniteNumber(payload.remaining, 'budget payload remaining')
    return
  }
  if (candidate.kind === 'cache-hit-anomaly') {
    assertNonNegativeSafeInteger(payload.episodeId, 'cache anomaly episodeId')
    assertFiniteNumber(payload.observedRate, 'cache anomaly observedRate')
    assertFiniteNumber(payload.threshold, 'cache anomaly threshold')
    assertNonNegativeSafeInteger(payload.sampleCount, 'cache anomaly sampleCount')
    assertNonNegativeSafeInteger(payload.consecutiveCalls, 'cache anomaly consecutiveCalls')
    assertNonNegativeSafeInteger(payload.observedAt, 'cache anomaly observedAt')
    if (payload.observedRate < 0 || payload.observedRate > 1 || payload.threshold < 0 || payload.threshold > 1) {
      throw new RangeError('cache anomaly rates must be within 0..1')
    }
    if (payload.sampleCount < 2 || payload.consecutiveCalls < 2 || payload.episodeId < 1) {
      throw new RangeError('cache anomaly counters are invalid')
    }
    return
  }
  if (payload.from !== 'peak' && payload.from !== 'offPeak') throw new TypeError('peak payload from is invalid')
  if (payload.to !== 'peak' && payload.to !== 'offPeak') throw new TypeError('peak payload to is invalid')
  if (payload.from === payload.to) throw new RangeError('peak payload must change period')
  assertNonEmptyString(payload.periodKey, 'peak payload periodKey')
  if ((candidate.kind === 'peak-enter') !== (payload.to === 'peak')) {
    throw new TypeError('peak event kind does not match its destination period')
  }
}

export function serializeNotificationEvent(event: TokenMonitorNotificationEvent): string {
  validateEvent(event)
  return JSON.stringify(event)
}

export function parseNotificationEvent(serialized: string): TokenMonitorNotificationEvent {
  let value: unknown
  try {
    value = JSON.parse(serialized)
  } catch {
    throw new TypeError('notification event JSON is invalid')
  }
  validateEvent(value)
  return value
}

/** In-memory stream cursor plus a separate bounded business-key dedupe index. */
export class NotificationEventBuffer {
  readonly streamId: string
  private readonly capacity: number
  private readonly dedupeCapacity: number
  private readonly events: TokenMonitorNotificationEvent[] = []
  private readonly seenKeys = new Set<string>()
  private readonly seenKeyOrder: string[] = []
  private seqCounter = 0

  constructor(options: NotificationEventBufferOptions = {}) {
    this.capacity = options.capacity ?? DEFAULT_NOTIFICATION_EVENT_CAPACITY
    this.dedupeCapacity = options.dedupeCapacity ?? DEFAULT_NOTIFICATION_DEDUPE_CAPACITY
    this.streamId = options.streamId ?? randomUUID()
    if (!Number.isSafeInteger(this.capacity) || this.capacity <= 0) throw new RangeError('capacity must be positive')
    if (!Number.isSafeInteger(this.dedupeCapacity) || this.dedupeCapacity < this.capacity) {
      throw new RangeError('dedupeCapacity must be an integer at least as large as capacity')
    }
    assertNonEmptyString(this.streamId, 'streamId')
  }

  publish(value: TokenMonitorNotificationDraft): TokenMonitorNotificationEvent | undefined {
    const nextSeq = this.seqCounter + 1
    const event = { ...value, seq: nextSeq } as TokenMonitorNotificationEvent
    validateEvent(event)
    if (this.seenKeys.has(value.dedupeKey)) return undefined
    this.seqCounter = nextSeq

    this.seenKeys.add(event.dedupeKey)
    this.seenKeyOrder.push(event.dedupeKey)
    if (this.seenKeyOrder.length > this.dedupeCapacity) {
      const expired = this.seenKeyOrder.shift()
      if (expired !== undefined) this.seenKeys.delete(expired)
    }

    this.events.push(event)
    if (this.events.length > this.capacity) this.events.splice(0, this.events.length - this.capacity)
    return event
  }

  currentSeq(): number {
    return this.seqCounter
  }

  since(since: number): TokenMonitorNotificationEvent[] {
    assertNonNegativeSafeInteger(since, 'since')
    if (since >= this.seqCounter) return []
    return this.events.filter(event => event.seq > since)
  }

  batchSince(since: number): TokenMonitorNotificationBatch {
    return { streamId: this.streamId, seq: this.seqCounter, events: this.since(since) }
  }
}

/**
 * Pure display planning: only consecutive charge events inside the window are
 * coalesced. Budget and peak transitions remain ordered, distinct queue items.
 */
export function coalesceNotificationEventsForDisplay(
  events: readonly TokenMonitorNotificationEvent[],
  windowMs = DEFAULT_CHARGE_COALESCE_WINDOW_MS,
): NotificationDisplayItem[] {
  if (!Number.isSafeInteger(windowMs) || windowMs < 0) throw new RangeError('windowMs must be a non-negative integer')
  const output: NotificationDisplayItem[] = []
  let pending: CoalescedChargeNotification | undefined

  const flush = (): void => {
    if (pending !== undefined) output.push(pending)
    pending = undefined
  }

  for (const event of events) {
    if (event.kind !== 'charge') {
      flush()
      output.push({ kind: 'event', event })
      continue
    }

    if (pending === undefined || event.timestamp - pending.lastTimestamp > windowMs) {
      flush()
      pending = {
        kind: 'charge-summary',
        firstSeq: event.seq,
        lastSeq: event.seq,
        firstTimestamp: event.timestamp,
        lastTimestamp: event.timestamp,
        cost: event.payload.cost,
        calls: 1,
        damageKind: event.payload.damageKind,
        eventIds: [event.id],
        dedupeKeys: [event.dedupeKey],
      }
      continue
    }

    pending.lastSeq = event.seq
    pending.lastTimestamp = event.timestamp
    pending.cost += event.payload.cost
    pending.calls++
    if (event.payload.damageKind === 'miss') pending.damageKind = 'miss'
    pending.eventIds.push(event.id)
    pending.dedupeKeys.push(event.dedupeKey)
  }
  flush()
  return output
}
