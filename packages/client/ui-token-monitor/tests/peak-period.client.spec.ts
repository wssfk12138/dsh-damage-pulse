import { describe, expect, it } from 'vitest'
import { isPeakPeriod } from '../src/client/peakPeriod.ts'

const beijing = (day: number, hour: number, minute = 0) => Date.UTC(2026, 7, day, hour - 8, minute)

describe('client peak-period projection', () => {
  it.each([
    ['Friday before first peak', beijing(21, 8, 59), false],
    ['Friday first peak start', beijing(21, 9), true],
    ['Friday noon valley start', beijing(21, 12), false],
    ['Friday second peak start', beijing(21, 14), true],
    ['Friday second peak end', beijing(21, 18), false],
    ['Saturday morning peak-shaped hour', beijing(22, 9), false],
    ['Saturday afternoon peak-shaped hour', beijing(22, 14), false],
    ['Sunday morning peak-shaped hour', beijing(23, 9), false],
    ['Monday morning peak', beijing(24, 9), true],
    ['statutory holiday morning peak-shaped hour', Date.UTC(2026, 9, 1, 10 - 8), false],
    ['statutory holiday afternoon peak-shaped hour', Date.UTC(2026, 8, 25, 14 - 8), false],
    ['ordinary Tuesday morning peak', Date.UTC(2026, 8, 29, 10 - 8), true],
  ])('%s', (_label, timestamp, expected) => {
    expect(isPeakPeriod(timestamp as number)).toBe(expected)
  })

})
