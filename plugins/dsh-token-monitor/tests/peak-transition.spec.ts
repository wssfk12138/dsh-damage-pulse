import { describe, expect, it, vi } from 'vitest'
import {
  PeakTransitionScheduler,
  nextPeakBoundary,
  peakPeriodAt,
  type PeakTransitionClock,
} from '../src/peak-transition.ts'

const at = (value: string): number => Date.parse(`${value}+08:00`)

class ManualClock implements PeakTransitionClock {
  private nextId = 1
  private timers = new Map<number, { at: number; callback: () => void }>()

  constructor(private value: number) {}

  now(): number { return this.value }

  setTimeout(callback: () => void, delayMs: number): number {
    const id = this.nextId++
    this.timers.set(id, { at: this.value + delayMs, callback })
    return id
  }

  clearTimeout(handle: unknown): void {
    this.timers.delete(handle as number)
  }

  jumpTo(value: number): void {
    this.value = value
  }

  fireDue(): void {
    const due = [...this.timers.entries()]
      .filter(([, timer]) => timer.at <= this.value)
      .sort((left, right) => left[1].at - right[1].at)
    for (const [id, timer] of due) {
      if (!this.timers.delete(id)) continue
      timer.callback()
    }
  }

  get timerCount(): number { return this.timers.size }
}

describe('peakPeriodAt', () => {
  it.each([
    ['2026-08-24T08:59:59.999', 'offPeak'],
    ['2026-08-24T09:00:00.000', 'peak'],
    ['2026-08-24T11:59:59.999', 'peak'],
    ['2026-08-24T12:00:00.000', 'offPeak'],
    ['2026-08-24T13:59:59.999', 'offPeak'],
    ['2026-08-24T14:00:00.000', 'peak'],
    ['2026-08-24T17:59:59.999', 'peak'],
    ['2026-08-24T18:00:00.000', 'offPeak'],
  ] as const)('classifies %s as %s', (value, expected) => {
    expect(peakPeriodAt(at(value))).toBe(expected)
  })

  it('keeps the whole weekend off-peak', () => {
    expect(peakPeriodAt(at('2026-08-22T00:00:00.000'))).toBe('offPeak')
    expect(peakPeriodAt(at('2026-08-23T23:59:59.999'))).toBe('offPeak')
  })
})

describe('nextPeakBoundary', () => {
  it.each([
    ['2026-08-24T08:59:59.000', '2026-08-24T09:00:00.000'],
    ['2026-08-24T09:00:00.000', '2026-08-24T12:00:00.000'],
    ['2026-08-24T18:00:00.000', '2026-08-25T09:00:00.000'],
    ['2026-08-21T18:00:00.000', '2026-08-24T09:00:00.000'],
    ['2026-08-22T10:00:00.000', '2026-08-24T09:00:00.000'],
  ])('finds %s -> %s', (value, expected) => {
    expect(nextPeakBoundary(at(value))).toBe(at(expected))
  })
})

describe('PeakTransitionScheduler', () => {
  it('removes the timer immediately and waits for an already started delivery', async () => {
    const clock = new ManualClock(at('2026-08-24T08:59:59'))
    let finish!: () => void
    const notify = vi.fn(() => new Promise<void>(resolve => { finish = resolve }))
    const scheduler = new PeakTransitionScheduler(notify, { clock })
    scheduler.start()
    clock.jumpTo(at('2026-08-24T09:00:00'))
    scheduler.check()
    let stopped = false
    const stopping = scheduler.stop().then(() => { stopped = true })
    await Promise.resolve()
    expect(stopped).toBe(false)
    clock.jumpTo(at('2026-08-24T12:00:00'))
    clock.fireDue()
    expect(notify).toHaveBeenCalledOnce()
    finish()
    await stopping
    expect(stopped).toBe(true)
  })
  it.each([
    ['2026-08-24T10:00:00.000'],
    ['2026-08-24T13:00:00.000'],
    ['2026-08-23T10:00:00.000'],
  ])('establishes a silent startup baseline at %s', (value) => {
    const clock = new ManualClock(at(value))
    const notify = vi.fn()
    const scheduler = new PeakTransitionScheduler(notify, { clock })
    scheduler.start()
    expect(notify).not.toHaveBeenCalled()
    expect(clock.timerCount).toBe(1)
  })

  it('emits once for every actual weekday boundary', () => {
    const clock = new ManualClock(at('2026-08-24T08:59:59.000'))
    const notify = vi.fn()
    const scheduler = new PeakTransitionScheduler(notify, { clock })
    scheduler.start()

    for (const value of [
      '2026-08-24T09:00:00.000',
      '2026-08-24T12:00:00.000',
      '2026-08-24T14:00:00.000',
      '2026-08-24T18:00:00.000',
    ]) {
      clock.jumpTo(at(value))
      clock.fireDue()
    }

    expect(notify.mock.calls.map(([transition]) => transition.to)).toEqual([
      'peak', 'offPeak', 'peak', 'offPeak',
    ])
  })

  it('does not emit again for duplicate checks at one boundary', () => {
    const clock = new ManualClock(at('2026-08-24T08:59:59.000'))
    const notify = vi.fn()
    const scheduler = new PeakTransitionScheduler(notify, { clock })
    scheduler.start()
    clock.jumpTo(at('2026-08-24T09:00:00.000'))
    scheduler.check()
    scheduler.check()
    expect(notify).toHaveBeenCalledOnce()
  })

  it('handles Friday to Saturday without a midnight notification', () => {
    const clock = new ManualClock(at('2026-08-21T17:59:59.000'))
    const notify = vi.fn()
    const scheduler = new PeakTransitionScheduler(notify, { clock })
    scheduler.start()
    clock.jumpTo(at('2026-08-21T18:00:00.000'))
    clock.fireDue()
    clock.jumpTo(at('2026-08-22T00:00:00.000'))
    scheduler.check()
    expect(notify.mock.calls.map(([transition]) => transition.to)).toEqual(['offPeak'])
  })

  it('crosses a weekday midnight without notifying until the next peak starts', () => {
    const clock = new ManualClock(at('2026-08-24T18:00:00.000'))
    const notify = vi.fn()
    const scheduler = new PeakTransitionScheduler(notify, { clock })
    scheduler.start()

    clock.jumpTo(at('2026-08-25T00:00:00.000'))
    scheduler.check()
    expect(notify).not.toHaveBeenCalled()

    clock.jumpTo(at('2026-08-25T09:00:00.000'))
    clock.fireDue()
    expect(notify.mock.calls.map(([transition]) => transition.to)).toEqual(['peak'])
  })

  it('emits once when the weekend off-peak period ends on Monday morning', () => {
    const clock = new ManualClock(at('2026-08-23T23:00:00.000'))
    const notify = vi.fn()
    const scheduler = new PeakTransitionScheduler(notify, { clock })
    scheduler.start()

    clock.jumpTo(at('2026-08-24T09:00:00.000'))
    clock.fireDue()
    scheduler.check()
    expect(notify.mock.calls.map(([transition]) => transition.to)).toEqual(['peak'])
  })

  it('emits one useful transition after a late sleep callback', () => {
    const clock = new ManualClock(at('2026-08-24T11:59:00.000'))
    const notify = vi.fn()
    const scheduler = new PeakTransitionScheduler(notify, { clock })
    scheduler.start()
    clock.jumpTo(at('2026-08-24T13:30:00.000'))
    clock.fireDue()
    expect(notify.mock.calls.map(([transition]) => transition.to)).toEqual(['offPeak'])
    expect(clock.timerCount).toBe(1)
  })

  it('does not replay stale transitions when sleep ends in the same period', () => {
    const clock = new ManualClock(at('2026-08-21T17:59:00.000'))
    const notify = vi.fn()
    const scheduler = new PeakTransitionScheduler(notify, { clock })
    scheduler.start()
    clock.jumpTo(at('2026-08-24T10:00:00.000'))
    clock.fireDue()
    expect(notify).not.toHaveBeenCalled()
    expect(clock.timerCount).toBe(1)
  })

  it('contains callback failures and keeps scheduling', async () => {
    const clock = new ManualClock(at('2026-08-24T08:59:00.000'))
    const onError = vi.fn()
    const scheduler = new PeakTransitionScheduler(
      () => Promise.reject(new Error('wechat unavailable')),
      { clock, onError },
    )
    scheduler.start()
    clock.jumpTo(at('2026-08-24T09:00:00.000'))
    clock.fireDue()
    await Promise.resolve()
    expect(onError).toHaveBeenCalledOnce()
    expect(clock.timerCount).toBe(1)
  })

  it('starts and stops idempotently and clears its timer', () => {
    const clock = new ManualClock(at('2026-08-24T08:00:00.000'))
    const scheduler = new PeakTransitionScheduler(vi.fn(), { clock })
    scheduler.start()
    scheduler.start()
    expect(clock.timerCount).toBe(1)
    scheduler.stop()
    scheduler.stop()
    expect(clock.timerCount).toBe(0)
  })
})
