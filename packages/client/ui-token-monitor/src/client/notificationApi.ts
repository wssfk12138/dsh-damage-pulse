import { PRODUCT_NAME } from './branding.ts'

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

const notificationKinds = ['charge', 'budget-threshold', 'peak-enter', 'peak-exit', 'cache-hit-anomaly'] as const
const priorities = ['normal', 'high'] as const
const maximumBatchEvents = 2_000

/** Notification kinds emitted by the Token Monitor Host stream. */
export type TokenMonitorNotificationKind = typeof notificationKinds[number]

/** Host-assigned display priority. */
export type TokenMonitorNotificationPriority = typeof priorities[number]

/** Charge data for one persisted model call. */
export interface ChargeNotificationPayload {
  cost: number
  damageKind: 'normal' | 'miss'
  sessionId: string
  turn: number
  step: number
  provider: string
  model: string
}

/** Daily budget crossing data. */
export interface BudgetThresholdNotificationPayload {
  date: string
  budget: number
  previousSpend: number
  currentSpend: number
  remaining: number
}

/** Peak-period boundary transition data. */
export interface PeakTransitionNotificationPayload {
  from: 'peak' | 'offPeak'
  to: 'peak' | 'offPeak'
  periodKey: string
}

/** Payload describing a sustained cache-hit-rate anomaly. */
export interface CacheHitAnomalyNotificationPayload {
  episodeId: number
  observedRate: number
  threshold: number
  sampleCount: number
  consecutiveCalls: number
  observedAt: number
}

interface NotificationEventBase<K extends TokenMonitorNotificationKind, P> {
  provider?: string
  model?: string
  schemaVersion: 1
  seq: number
  id: string
  dedupeKey: string
  kind: K
  timestamp: number
  priority: TokenMonitorNotificationPriority
  payload: P
}

/** One model-call charge notification. */
export type ChargeNotificationEvent = NotificationEventBase<'charge', ChargeNotificationPayload>

/** One daily-budget threshold notification. */
export type BudgetThresholdNotificationEvent = NotificationEventBase<
  'budget-threshold',
  BudgetThresholdNotificationPayload
>

/** One transition into the peak period. */
export type PeakEnterNotificationEvent = NotificationEventBase<'peak-enter', PeakTransitionNotificationPayload>

/** One transition out of the peak period. */
export type PeakExitNotificationEvent = NotificationEventBase<'peak-exit', PeakTransitionNotificationPayload>
/** Notification event emitted for a sustained cache-hit-rate anomaly. */
export type CacheHitAnomalyNotificationEvent = NotificationEventBase<'cache-hit-anomaly', CacheHitAnomalyNotificationPayload>

/** Strictly validated notification event received from the Host. */
export type TokenMonitorNotificationEvent =
  | ChargeNotificationEvent
  | BudgetThresholdNotificationEvent
  | PeakEnterNotificationEvent
  | PeakExitNotificationEvent
  | CacheHitAnomalyNotificationEvent

/** Incremental Host response for one notification stream instance. */
export interface TokenMonitorNotificationBatch {
  streamId: string
  seq: number
  events: TokenMonitorNotificationEvent[]
}

/** Client cursor used for incremental polling. */
export interface NotificationEventsCursor {
  streamId?: string
  seq: number
}

/** Successful fail-soft poll result. */
export interface NotificationEventsPollSuccess {
  ok: true
  requestedCursor: NotificationEventsCursor
  streamChanged: boolean
  batch: TokenMonitorNotificationBatch
}

/** Failure categories that the main window may ignore and retry. */
export type NotificationEventsPollFailureKind = 'aborted' | 'network' | 'http' | 'protocol' | 'unavailable'

/** Serializable failure description returned instead of rejecting a fail-soft poll. */
export interface NotificationEventsPollFailure {
  ok: false
  failure: {
    kind: NotificationEventsPollFailureKind
    message: string
    status?: number
  }
}

/** Result of a fail-soft notification poll. */
export type NotificationEventsPollResult = NotificationEventsPollSuccess | NotificationEventsPollFailure

/** HTTP failure from the notification endpoint. */
export class NotificationEventsApiError extends Error {
  constructor(readonly status: number) {
    super(`${PRODUCT_NAME} notification request failed (HTTP ${String(status)})`)
    this.name = 'NotificationEventsApiError'
  }
}

/** Invalid JSON or response fields from the notification endpoint. */
export class NotificationEventsProtocolError extends Error {
  constructor(readonly field: string) {
    super(`${PRODUCT_NAME} notification response is invalid: ${field}`)
    this.name = 'NotificationEventsProtocolError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype: unknown = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function exact(record: Record<string, unknown>, fields: readonly string[]): boolean {
  // Unknown fields are ignored for forward compatibility; parsed output below
  // copies only the validated contract fields, so future sensitive fields do not leak.
  return fields.every(field => Object.prototype.hasOwnProperty.call(record, field))
}

function boundedString(value: unknown, maximum: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maximum
}

function nonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function parseBase(value: Record<string, unknown>, kind: TokenMonitorNotificationKind): {
  provider?: string
  model?: string
  seq: number
  id: string
  dedupeKey: string
  timestamp: number
  priority: TokenMonitorNotificationPriority
} {
  if (value.schemaVersion !== 1) throw new NotificationEventsProtocolError('events[].schemaVersion')
  if (value.provider !== undefined && !boundedString(value.provider, 256)) throw new NotificationEventsProtocolError('events[].provider')
  if (value.model !== undefined && !boundedString(value.model, 256)) throw new NotificationEventsProtocolError('events[].model')
  if (!nonNegativeSafeInteger(value.seq) || value.seq === 0) {
    throw new NotificationEventsProtocolError('events[].seq')
  }
  if (!boundedString(value.id, 256)) throw new NotificationEventsProtocolError('events[].id')
  if (!boundedString(value.dedupeKey, 256) || value.dedupeKey !== value.id) {
    throw new NotificationEventsProtocolError('events[].dedupeKey')
  }
  if (value.kind !== kind) throw new NotificationEventsProtocolError('events[].kind')
  if (!nonNegativeSafeInteger(value.timestamp)) throw new NotificationEventsProtocolError('events[].timestamp')
  if (!priorities.includes(value.priority as TokenMonitorNotificationPriority)) {
    throw new NotificationEventsProtocolError('events[].priority')
  }
  return {
    ...(value.provider === undefined ? {} : { provider: value.provider as string }),
    ...(value.model === undefined ? {} : { model: value.model as string }),
    seq: value.seq,
    id: value.id,
    dedupeKey: value.dedupeKey,
    timestamp: value.timestamp,
    priority: value.priority as TokenMonitorNotificationPriority,
  }
}

function parseChargePayload(value: unknown): ChargeNotificationPayload {
  const fields = ['cost', 'damageKind', 'sessionId', 'turn', 'step', 'provider', 'model']
  if (!isRecord(value) || !exact(value, fields)) throw new NotificationEventsProtocolError('events[].payload')
  if (!finiteNumber(value.cost) || value.cost <= 0) throw new NotificationEventsProtocolError('events[].payload.cost')
  if (value.damageKind !== 'normal' && value.damageKind !== 'miss') {
    throw new NotificationEventsProtocolError('events[].payload.damageKind')
  }
  if (!boundedString(value.sessionId, 256)) throw new NotificationEventsProtocolError('events[].payload.sessionId')
  if (!nonNegativeSafeInteger(value.turn)) throw new NotificationEventsProtocolError('events[].payload.turn')
  if (!nonNegativeSafeInteger(value.step)) throw new NotificationEventsProtocolError('events[].payload.step')
  if (!boundedString(value.provider, 256)) throw new NotificationEventsProtocolError('events[].payload.provider')
  if (!boundedString(value.model, 256)) throw new NotificationEventsProtocolError('events[].payload.model')
  return {
    cost: value.cost,
    damageKind: value.damageKind,
    sessionId: value.sessionId,
    turn: value.turn,
    step: value.step,
    provider: value.provider,
    model: value.model,
  }
}

function parseBudgetPayload(value: unknown): BudgetThresholdNotificationPayload {
  const fields = ['date', 'budget', 'previousSpend', 'currentSpend', 'remaining']
  if (!isRecord(value) || !exact(value, fields)) throw new NotificationEventsProtocolError('events[].payload')
  if (typeof value.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.date)) {
    throw new NotificationEventsProtocolError('events[].payload.date')
  }
  if (!finiteNumber(value.budget) || value.budget <= 0) {
    throw new NotificationEventsProtocolError('events[].payload.budget')
  }
  if (!finiteNumber(value.previousSpend) || value.previousSpend < 0) {
    throw new NotificationEventsProtocolError('events[].payload.previousSpend')
  }
  if (!finiteNumber(value.currentSpend) || value.currentSpend < value.budget || value.previousSpend >= value.budget) {
    throw new NotificationEventsProtocolError('events[].payload.currentSpend')
  }
  if (!finiteNumber(value.remaining)) throw new NotificationEventsProtocolError('events[].payload.remaining')
  return {
    date: value.date,
    budget: value.budget,
    previousSpend: value.previousSpend,
    currentSpend: value.currentSpend,
    remaining: value.remaining,
  }
}

function parsePeakPayload(value: unknown, kind: 'peak-enter' | 'peak-exit'): PeakTransitionNotificationPayload {
  const fields = ['from', 'to', 'periodKey']
  if (!isRecord(value) || !exact(value, fields)) throw new NotificationEventsProtocolError('events[].payload')
  if (value.from !== 'peak' && value.from !== 'offPeak') {
    throw new NotificationEventsProtocolError('events[].payload.from')
  }
  if (value.to !== 'peak' && value.to !== 'offPeak') {
    throw new NotificationEventsProtocolError('events[].payload.to')
  }
  if (value.from === value.to || (kind === 'peak-enter') !== (value.to === 'peak')) {
    throw new NotificationEventsProtocolError('events[].payload.to')
  }
  if (!boundedString(value.periodKey, 256)) {
    throw new NotificationEventsProtocolError('events[].payload.periodKey')
  }
  return { from: value.from, to: value.to, periodKey: value.periodKey }
}

function parseCacheHitAnomalyPayload(value: unknown): CacheHitAnomalyNotificationPayload {
  const fields = ['episodeId', 'observedRate', 'threshold', 'sampleCount', 'consecutiveCalls', 'observedAt']
  if (!isRecord(value) || !exact(value, fields)) throw new NotificationEventsProtocolError('events[].payload')
  if (!nonNegativeSafeInteger(value.episodeId) || value.episodeId < 1) throw new NotificationEventsProtocolError('events[].payload.episodeId')
  if (!finiteNumber(value.observedRate) || value.observedRate < 0 || value.observedRate > 1) throw new NotificationEventsProtocolError('events[].payload.observedRate')
  if (!finiteNumber(value.threshold) || value.threshold < 0 || value.threshold > 1) throw new NotificationEventsProtocolError('events[].payload.threshold')
  if (!nonNegativeSafeInteger(value.sampleCount) || value.sampleCount < 2) throw new NotificationEventsProtocolError('events[].payload.sampleCount')
  if (!nonNegativeSafeInteger(value.consecutiveCalls) || value.consecutiveCalls < 2) throw new NotificationEventsProtocolError('events[].payload.consecutiveCalls')
  if (!nonNegativeSafeInteger(value.observedAt)) throw new NotificationEventsProtocolError('events[].payload.observedAt')
  return {
    episodeId: value.episodeId,
    observedRate: value.observedRate,
    threshold: value.threshold,
    sampleCount: value.sampleCount,
    consecutiveCalls: value.consecutiveCalls,
    observedAt: value.observedAt,
  }
}

function parseEvent(value: unknown): TokenMonitorNotificationEvent {
  const fields = ['schemaVersion', 'seq', 'id', 'dedupeKey', 'kind', 'timestamp', 'priority', 'payload']
  if (!isRecord(value) || !exact(value, fields)) throw new NotificationEventsProtocolError('events[]')
  if (!notificationKinds.includes(value.kind as TokenMonitorNotificationKind)) {
    throw new NotificationEventsProtocolError('events[].kind')
  }
  const kind = value.kind as TokenMonitorNotificationKind
  const base = parseBase(value, kind)
  switch (kind) {
    case 'charge':
      return { schemaVersion: 1, ...base, kind, payload: parseChargePayload(value.payload) }
    case 'budget-threshold':
      return { schemaVersion: 1, ...base, kind, payload: parseBudgetPayload(value.payload) }
    case 'peak-enter':
    case 'peak-exit':
      return { schemaVersion: 1, ...base, kind, payload: parsePeakPayload(value.payload, kind) }
    case 'cache-hit-anomaly':
      return { schemaVersion: 1, ...base, kind, payload: parseCacheHitAnomalyPayload(value.payload) }
  }
}

/**
 * Validate and copy an untrusted notification response.
 * @param value Parsed JSON from the Host endpoint.
 * @returns A batch containing only validated fields.
 */
export function parseNotificationEventsBatch(value: unknown): TokenMonitorNotificationBatch {
  if (!isRecord(value) || !exact(value, ['streamId', 'seq', 'events'])) {
    throw new NotificationEventsProtocolError('response')
  }
  if (!boundedString(value.streamId, 128)) throw new NotificationEventsProtocolError('streamId')
  if (!nonNegativeSafeInteger(value.seq)) throw new NotificationEventsProtocolError('seq')
  if (!Array.isArray(value.events) || value.events.length > maximumBatchEvents) {
    throw new NotificationEventsProtocolError('events')
  }

  const events = value.events.map(parseEvent)
  let previousSeq = 0
  const dedupeKeys = new Set<string>()
  for (const event of events) {
    if (event.seq <= previousSeq || event.seq > value.seq) {
      throw new NotificationEventsProtocolError('events[].seq')
    }
    if (dedupeKeys.has(event.dedupeKey)) throw new NotificationEventsProtocolError('events[].dedupeKey')
    previousSeq = event.seq
    dedupeKeys.add(event.dedupeKey)
  }
  return { streamId: value.streamId, seq: value.seq, events }
}

function assertSince(since: number): void {
  if (!Number.isSafeInteger(since) || since < 0) throw new RangeError('since must be a non-negative safe integer')
}

function assertCursor(cursor: NotificationEventsCursor): void {
  assertSince(cursor.seq)
  if (cursor.streamId === undefined) {
    if (cursor.seq !== 0) throw new RangeError('a cursor without streamId must start at seq 0')
    return
  }
  if (!boundedString(cursor.streamId, 128)) throw new RangeError('cursor.streamId must be a non-empty string')
}

function isAbort(error: unknown, signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true || (error instanceof Error && error.name === 'AbortError')
}

function failure(error: unknown, signal: AbortSignal | undefined): NotificationEventsPollFailure {
  if (isAbort(error, signal)) return { ok: false, failure: { kind: 'aborted', message: 'Notification poll was aborted' } }
  if (error instanceof NotificationEventsApiError) {
    return {
      ok: false,
      failure: { kind: error.status === 204 ? 'unavailable' : 'http', message: error.message, status: error.status },
    }
  }
  if (error instanceof NotificationEventsProtocolError) {
    return { ok: false, failure: { kind: 'protocol', message: error.message } }
  }
  const message = error instanceof Error ? error.message : 'Notification request failed'
  return { ok: false, failure: { kind: 'network', message } }
}

/** Browser-safe notification endpoint operations. */
export interface NotificationEventsApi {
  /** Strict request that rejects HTTP, network, and protocol failures. */
  get(since: number, signal?: AbortSignal): Promise<TokenMonitorNotificationBatch>
  /** Fail-soft poll that also recovers the beginning of a restarted Host stream. */
  poll(cursor: NotificationEventsCursor, signal?: AbortSignal): Promise<NotificationEventsPollResult>
}

/**
 * Create a browser client for the Host notification stream.
 * @param fetcher Fetch implementation used by the browser runtime or tests.
 * @param endpoint Notification endpoint path.
 * @returns Strict and fail-soft notification operations.
 */
export function createNotificationEventsApi(
  fetcher: FetchLike = fetch,
  endpoint = '/api/token-monitor/modules/notification-events',
): NotificationEventsApi {
  const request = async (since: number, signal?: AbortSignal): Promise<TokenMonitorNotificationBatch> => {
    assertSince(since)
    const separator = endpoint.includes('?') ? '&' : '?'
    const response = await fetcher(`${endpoint}${separator}since=${String(since)}`, {
      method: 'GET',
      cache: 'no-store',
      ...(signal === undefined ? {} : { signal }),
    })
    if (!response.ok || response.status === 204) throw new NotificationEventsApiError(response.status)
    let value: unknown
    try {
      value = await response.json()
    } catch {
      throw new NotificationEventsProtocolError('response')
    }
    return parseNotificationEventsBatch(value)
  }

  return {
    get: request,
    async poll(cursor, signal) {
      assertCursor(cursor)
      try {
        let batch = await request(cursor.seq, signal)
        const streamChanged = cursor.streamId !== undefined && batch.streamId !== cursor.streamId
        if (streamChanged && cursor.seq !== 0) batch = await request(0, signal)
        return {
          ok: true,
          requestedCursor: { ...cursor },
          streamChanged,
          batch,
        }
      } catch (error) {
        return failure(error, signal)
      }
    },
  }
}
