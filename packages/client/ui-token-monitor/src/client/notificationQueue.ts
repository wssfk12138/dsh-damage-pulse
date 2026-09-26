import type {
  NotificationEventsPollResult,
  NotificationEventsPollFailure,
  NotificationEventsCursor,
  TokenMonitorNotificationBatch,
  TokenMonitorNotificationEvent,
} from './notificationApi.ts'

const defaultDedupeCapacity = 2_000

/** Match reminders to the visible task without letting background providers take over.
 * Legacy unscoped reminders belong only to the original official provider.
 */
export function notificationMatchesScope(
  event: TokenMonitorNotificationEvent,
  scope: { provider: string; model: string; sessionId?: string } | undefined,
): boolean {
  if (!scope) return false
  if (event.kind === 'charge') return event.payload.provider === scope.provider
    && event.payload.model === scope.model && event.payload.sessionId === scope.sessionId
  if ((event.provider ?? 'deepseek-official') !== scope.provider) return false
  return event.model === undefined || event.model === scope.model
}

/** Ordered visual item consumed by the main window. */
export type NotificationVisualItem = {
  kind: 'event'
  event: Exclude<TokenMonitorNotificationEvent, { kind: 'charge' }>
}

/** Serializable queue state retained by the main window. */
export interface NotificationQueueState {
  cursor: NotificationEventsCursor
  ready: readonly NotificationVisualItem[]
  seenDedupeKeys: readonly string[]
  dedupeCapacity: number
}

/** Queue construction options. */
export interface NotificationQueueOptions {
  dedupeCapacity?: number
}

/** Result metadata for applying a Host batch or fail-soft poll. */
export interface NotificationQueueUpdate {
  state: NotificationQueueState
  accepted: number
  streamChanged: boolean
  stale: boolean
  failure?: NotificationEventsPollFailure['failure']
}

/** Result of consuming at most one ready visual item. */
export type NotificationQueueDequeueResult =
  | { state: NotificationQueueState; item: NotificationVisualItem }
  | { state: NotificationQueueState }

function assertNonNegativeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${name} must be a non-negative safe integer`)
}

function appendSeen(keys: string[], key: string, capacity: number): void {
  keys.push(key)
  if (keys.length > capacity) keys.splice(0, keys.length - capacity)
}

function cursorsEqual(left: NotificationEventsCursor, right: NotificationEventsCursor): boolean {
  return left.seq === right.seq && left.streamId === right.streamId
}

/**
 * Create an empty notification queue.
 * @param options Bounded dedupe options.
 * @returns Initial state with an unbound stream cursor.
 */
export function createNotificationQueueState(options: NotificationQueueOptions = {}): NotificationQueueState {
  const dedupeCapacity = options.dedupeCapacity ?? defaultDedupeCapacity
  if (!Number.isSafeInteger(dedupeCapacity) || dedupeCapacity <= 0) {
    throw new RangeError('dedupeCapacity must be a positive safe integer')
  }
  return {
    cursor: { seq: 0 },
    ready: [],
    seenDedupeKeys: [],
    dedupeCapacity,
  }
}

/**
 * Apply a validated Host batch without mutating its raw events.
 * @param state Current immutable queue state.
 * @param batch Strictly parsed Host batch.
 * @param now Current epoch time, validated for consistency with poll callers.
 * @returns Updated queue state and stream/application metadata.
 */
export function applyNotificationBatch(
  state: NotificationQueueState,
  batch: TokenMonitorNotificationBatch,
  now: number,
): NotificationQueueUpdate {
  assertNonNegativeInteger(now, 'now')
  const sameStream = state.cursor.streamId === batch.streamId
  const streamChanged = state.cursor.streamId !== undefined && !sameStream
  if (sameStream && batch.seq < state.cursor.seq) {
    return {
      state,
      accepted: 0,
      streamChanged: false,
      stale: true,
    }
  }

  const ready = [...state.ready]
  const seenDedupeKeys = [...state.seenDedupeKeys]
  const seen = new Set(seenDedupeKeys)
  let accepted = 0

  for (const event of batch.events) {
    if (sameStream && event.seq <= state.cursor.seq) continue
    if (seen.has(event.dedupeKey)) continue
    seen.add(event.dedupeKey)
    appendSeen(seenDedupeKeys, event.dedupeKey, state.dedupeCapacity)
    accepted++

    // Charge details are already rendered by the dedicated damage animation.
    if (event.kind !== 'charge') ready.push({ kind: 'event', event })
  }

  const nextState: NotificationQueueState = {
    ...state,
    cursor: { streamId: batch.streamId, seq: batch.seq },
    ready,
    seenDedupeKeys,
  }
  return { state: nextState, accepted, streamChanged, stale: false }
}

/**
 * Apply a fail-soft API result and ignore stale concurrent poll completions.
 * @param state Current immutable queue state.
 * @param result Result returned by NotificationEventsApi.poll.
 * @param now Current epoch time, validated by the batch application path.
 * @returns Updated state; failures preserve the cursor and queued events.
 */
export function applyNotificationPollResult(
  state: NotificationQueueState,
  result: NotificationEventsPollResult,
  now: number,
): NotificationQueueUpdate {
  if (!result.ok) {
    return {
      state,
      accepted: 0,
      streamChanged: false,
      stale: false,
      failure: result.failure,
    }
  }
  if (!cursorsEqual(state.cursor, result.requestedCursor)) {
    return {
      state,
      accepted: 0,
      streamChanged: false,
      stale: true,
    }
  }
  return applyNotificationBatch(state, result.batch, now)
}

/**
 * Consume at most one ready visual item.
 * @param state Current immutable queue state.
 * @param now Current epoch time in milliseconds.
 * @returns The next visual item and remaining state, or only the advanced state.
 */
export function dequeueNotificationItem(
  state: NotificationQueueState,
  now: number,
): NotificationQueueDequeueResult {
  assertNonNegativeInteger(now, 'now')
  const item = state.ready[0]
  if (item === undefined) return { state }
  return { state: { ...state, ready: state.ready.slice(1) }, item }
}
