/** Beijing-time peak/off-peak classification and boundary scheduling. */

export type PeakPeriod = 'peak' | 'offPeak'

export interface PeakTransition {
  from: PeakPeriod
  to: PeakPeriod
  observedAt: number
  key: string
}

export interface PeakTransitionClock {
  now(): number
  setTimeout(callback: () => void, delayMs: number): unknown
  clearTimeout(handle: unknown): void
}

export interface PeakTransitionSchedulerOptions {
  clock?: PeakTransitionClock
  onError?: (error: unknown) => void
}

const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000
const PEAK_BOUNDARY_MINUTES = [9 * 60, 12 * 60, 14 * 60, 18 * 60] as const

const systemClock: PeakTransitionClock = {
  now: () => Date.now(),
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
}

function beijingDate(timestamp: number): Date {
  return new Date(timestamp + SHANGHAI_OFFSET_MS)
}

function isWeekday(day: number): boolean {
  return day >= 1 && day <= 5
}

function localTimestamp(date: Date, minutes: number): number {
  return Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    Math.floor(minutes / 60),
    minutes % 60,
  ) - SHANGHAI_OFFSET_MS
}

/** Return the effective billing period at an epoch timestamp. */
export function peakPeriodAt(timestamp: number): PeakPeriod {
  const local = beijingDate(timestamp)
  if (!isWeekday(local.getUTCDay())) return 'offPeak'
  const minutes = local.getUTCHours() * 60 + local.getUTCMinutes()
  return (minutes >= 9 * 60 && minutes < 12 * 60)
    || (minutes >= 14 * 60 && minutes < 18 * 60)
    ? 'peak'
    : 'offPeak'
}

/** Return the first genuine period boundary strictly after `timestamp`. */
export function nextPeakBoundary(timestamp: number): number {
  const local = beijingDate(timestamp)
  for (let dayOffset = 0; dayOffset <= 7; dayOffset++) {
    const day = new Date(Date.UTC(
      local.getUTCFullYear(),
      local.getUTCMonth(),
      local.getUTCDate() + dayOffset,
    ))
    if (!isWeekday(day.getUTCDay())) continue
    for (const minutes of PEAK_BOUNDARY_MINUTES) {
      const candidate = localTimestamp(day, minutes)
      if (candidate > timestamp) return candidate
    }
  }
  throw new Error('peak transition: failed to find the next weekday boundary')
}

/** Stable idempotency key for the current effective period segment. */
export function peakPeriodKey(timestamp: number): string {
  const local = beijingDate(timestamp)
  let start: number | undefined

  if (isWeekday(local.getUTCDay())) {
    const minutes = local.getUTCHours() * 60 + local.getUTCMinutes()
    if (minutes >= 18 * 60) start = localTimestamp(local, 18 * 60)
    else if (minutes >= 14 * 60) start = localTimestamp(local, 14 * 60)
    else if (minutes >= 12 * 60) start = localTimestamp(local, 12 * 60)
    else if (minutes >= 9 * 60) start = localTimestamp(local, 9 * 60)
  }

  if (start === undefined) {
    for (let dayOffset = 1; dayOffset <= 7; dayOffset++) {
      const prior = new Date(Date.UTC(
        local.getUTCFullYear(),
        local.getUTCMonth(),
        local.getUTCDate() - dayOffset,
      ))
      if (!isWeekday(prior.getUTCDay())) continue
      start = localTimestamp(prior, 18 * 60)
      break
    }
  }

  if (start === undefined) throw new Error('peak transition: failed to identify the current period')
  return `${peakPeriodAt(timestamp)}:${start}`
}

/**
 * Owns one timer and compares effective state, rather than replaying scheduled
 * boundaries. A late callback after sleep therefore emits at most one useful
 * transition and emits nothing when the current state still matches baseline.
 */
export class PeakTransitionScheduler {
  private readonly clock: PeakTransitionClock
  private readonly onError: (error: unknown) => void
  private running = false
  private timer: unknown
  private period: PeakPeriod | undefined
  private lastEmittedKey: string | undefined
  private readonly pending = new Set<Promise<void>>()

  constructor(
    private readonly onTransition: (transition: PeakTransition) => void | Promise<void>,
    options: PeakTransitionSchedulerOptions = {},
  ) {
    this.clock = options.clock ?? systemClock
    this.onError = options.onError ?? (() => {})
  }

  /** Start with a silent baseline. Repeated starts are no-ops. */
  start(): void {
    if (this.running) return
    this.running = true
    this.period = peakPeriodAt(this.clock.now())
    this.lastEmittedKey = undefined
    this.scheduleNext()
  }

  /** Stop and release the owned timer. Repeated stops are no-ops. */
  async stop(): Promise<void> {
    this.running = false
    if (this.timer !== undefined) this.clock.clearTimeout(this.timer)
    this.timer = undefined
    this.period = undefined
    this.lastEmittedKey = undefined
    await Promise.allSettled(this.pending)
  }

  /** Check current state immediately; useful for timer callbacks and tests. */
  check(): void {
    if (!this.running) return
    const observedAt = this.clock.now()
    const nextPeriod = peakPeriodAt(observedAt)
    const previousPeriod = this.period
    this.period = nextPeriod

    if (previousPeriod !== undefined && previousPeriod !== nextPeriod) {
      const key = peakPeriodKey(observedAt)
      if (key !== this.lastEmittedKey) {
        // Commit transition/dedupe state before invoking any asynchronous adapter.
        this.lastEmittedKey = key
        const transition = { from: previousPeriod, to: nextPeriod, observedAt, key }
        try {
          const delivery = Promise.resolve(this.onTransition(transition)).catch(error => this.report(error))
          this.pending.add(delivery)
          void delivery.then(() => this.pending.delete(delivery))
        } catch (error) {
          this.report(error)
        }
      }
    }

    this.scheduleNext()
  }

  private scheduleNext(): void {
    if (!this.running) return
    if (this.timer !== undefined) this.clock.clearTimeout(this.timer)
    const now = this.clock.now()
    const delayMs = Math.max(1, nextPeakBoundary(now) - now)
    this.timer = this.clock.setTimeout(() => {
      this.timer = undefined
      this.check()
    }, delayMs)
  }

  private report(error: unknown): void {
    try {
      this.onError(error)
    } catch {
      // Error reporting is outside the accounting path and must stay contained.
    }
  }
}
