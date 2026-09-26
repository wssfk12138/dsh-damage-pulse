// @vitest-environment jsdom

/**
 * The magnitude model is the single place that decides "how big is this hit".
 * It is pure, so the scaling contract is worth pinning here rather than only through
 * the rendered DOM: a regression that inverts a comparison (a ¥5 charge looking
 * lighter than a ¥0.001 one) would still pass a test that only counts sparks.
 */
import { describe, expect, it } from 'vitest'
import { TOKEN_MONITOR_DAMAGE_EFFECT_LEVELS } from '../../../util/token-monitor-contract/src/index.ts'
import {
  DAMAGE_EFFECT_LABELS,
  MAX_MAGNITUDE,
  MIN_MAGNITUDE,
  applyEffectLevel,
  damageMagnitude,
  damageVisuals,
  isDamageEffectOff,
  sampleDirections,
} from '../src/client/damageScale.ts'

const MAX_HEALTH = 100

function magnitude(kind: 'normal' | 'miss' | 'output', cost: number): number {
  return damageMagnitude(kind, cost, cost / MAX_HEALTH)
}

describe('damage magnitude', () => {
  it('grows monotonically with the amount spent', () => {
    const ladder = [0.0001, 0.001, 0.01, 0.1, 1, 10].map(cost => magnitude('normal', cost))

    for (let index = 1; index < ladder.length; index += 1) {
      expect(ladder[index]).toBeGreaterThanOrEqual(ladder[index - 1] as number)
    }
    expect(ladder[0]).toBe(MIN_MAGNITUDE)
    // 普通扣费不会顶到上限：上限留给暴击，普通扣费的封顶是 上限 / 暴击基准。
    expect(ladder.at(-1)).toBeCloseTo(MAX_MAGNITUDE / 1.5, 5)
    expect(ladder.at(-1)).toBeLessThan(MAX_MAGNITUDE)
    // 最重的类型在满强度时才正好顶到上限——区间两端都取得到。
    expect(magnitude('miss', 10)).toBeCloseTo(MAX_MAGNITUDE, 5)
  })

  it('stays inside the clamp so a huge charge cannot blow the card apart', () => {
    for (const cost of [0, 1e-9, 1_000, 1e9]) {
      const value = magnitude('miss', cost)
      expect(value).toBeGreaterThanOrEqual(MIN_MAGNITUDE)
      expect(value).toBeLessThanOrEqual(MAX_MAGNITUDE)
    }
  })

  it('treats the same spend as heavier when it eats a bigger share of the bar', () => {
    const cost = 0.5
    // Same ¥0.5, but against a ¥5 bar it wipes out a tenth of the health.
    const wideBar = damageMagnitude('normal', cost, cost / 10_000)
    const narrowBar = damageMagnitude('normal', cost, cost / 5)

    expect(narrowBar).toBeGreaterThan(wideBar)
  })

  it('ranks cache misses above ordinary hits and output hits in between', () => {
    const cost = 0.02
    const normal = magnitude('normal', cost)
    const output = magnitude('output', cost)
    const miss = magnitude('miss', cost)

    expect(output).toBeGreaterThan(normal)
    expect(miss).toBeGreaterThan(output)
  })

  it('falls back to the per-kind base when the amount is unknown', () => {
    // 回血/异常路径可能拿不到金额：仍然要有可见特效，按类型给基准值。
    expect(damageMagnitude('normal', undefined, 0)).toBeGreaterThan(0)
    expect(damageMagnitude('normal', Number.NaN, 0)).toBe(MIN_MAGNITUDE)
    expect(damageMagnitude('miss', undefined, 0)).toBeGreaterThan(damageMagnitude('normal', undefined, 0))
  })
})

describe('damage visuals', () => {
  it('keeps every derived size and duration monotonic in the magnitude', () => {
    const keys = ['ringSize', 'sparkSize', 'sparkCount', 'shakeAmplitude', 'shakeDuration', 'flashOpacity', 'floatFontSize'] as const
    const steps = [MIN_MAGNITUDE, 1, 1.5, 2, 2.5, MAX_MAGNITUDE].map(damageVisuals)

    for (const key of keys) {
      for (let index = 1; index < steps.length; index += 1) {
        expect(steps[index]?.[key]).toBeGreaterThanOrEqual(steps[index - 1]?.[key] as number)
      }
      // 每一档都必须真的在变，否则「随扣血多少变化」就名不副实。
      expect(steps.at(-1)?.[key]).toBeGreaterThan(steps[0]?.[key] as number)
    }
  })

  it('keeps the spark count within what the direction ring can supply', () => {
    expect(damageVisuals(MIN_MAGNITUDE).sparkCount).toBeGreaterThanOrEqual(4)
    expect(damageVisuals(MAX_MAGNITUDE).sparkCount).toBeLessThanOrEqual(10)
  })
})

describe('spark direction sampling', () => {
  const ring = Array.from({ length: 10 }, (_, index) => index)

  it('returns exactly the requested count without duplicates', () => {
    for (const count of [1, 4, 5, 7, 10]) {
      const picked = sampleDirections(ring, count)
      expect(picked).toHaveLength(count)
      expect(new Set(picked).size).toBe(count)
    }
  })

  it('spreads picks around the ring instead of truncating one side', () => {
    // 截断前 5 个会让火花全挤在同一侧，等分采样才能绕一圈。
    const picked = sampleDirections(ring, 5)
    expect(picked).toEqual([0, 2, 4, 6, 8])
  })

  it('degrades safely when the ring is empty', () => {
    expect(sampleDirections([], 6)).toEqual([])
  })
})

describe('damage effect level', () => {
  it('labels every level the wire accepts', () => {
    // 契约与档位表是两份表：漏一个 label 会让菜单出现空白按钮。
    for (const level of TOKEN_MONITOR_DAMAGE_EFFECT_LEVELS) {
      expect(DAMAGE_EFFECT_LABELS[level]?.length).toBeGreaterThan(0)
    }
    expect(Object.keys(DAMAGE_EFFECT_LABELS).sort()).toEqual([...TOKEN_MONITOR_DAMAGE_EFFECT_LEVELS].sort())
  })

  it('scales the magnitude strictly upward across the ladder', () => {
    const base = damageMagnitude('normal', 0.5, 0.005)
    const scaled = TOKEN_MONITOR_DAMAGE_EFFECT_LEVELS.map(level => applyEffectLevel(base, level))

    for (let index = 1; index < scaled.length; index += 1) {
      expect(scaled[index]).toBeGreaterThan(scaled[index - 1] as number)
    }
    // normal 档必须是恒等变换，否则默认行为会被悄悄改变。
    expect(applyEffectLevel(base, 'normal')).toBe(base)
  })

  it('makes off a true zero so the caller can skip the effect entirely', () => {
    expect(applyEffectLevel(3, 'off')).toBe(0)
    expect(isDamageEffectOff('off')).toBe(true)
    for (const level of TOKEN_MONITOR_DAMAGE_EFFECT_LEVELS) {
      if (level !== 'off') expect(isDamageEffectOff(level)).toBe(false)
    }
  })

  it('falls back to the model value for an unrecognised level', () => {
    // Host 存了客户端还不认识的档位时，宁可照常画特效也不要画出 0 尺寸。
    expect(applyEffectLevel(2, 'gigantic' as never)).toBe(2)
  })
})
