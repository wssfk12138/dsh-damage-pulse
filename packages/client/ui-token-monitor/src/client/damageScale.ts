/**
 * 扣血特效的强度模型。
 *
 * 「这一笔掉了多少」折成一个倍率，血条抖动、冲击环、火花数量与尺寸、闪白强度、
 * 飘字字号都从它派生——特效强弱只在这一个地方定义，改动不会散落在 JSX 里。
 *
 * 强度取两个信号的较大者：
 * - 绝对金额：¥0.001 几乎无感，¥1 以上拉满（对数刻度，因为单次调用金额跨好几个数量级）
 * - 占血条的百分比：同样掉 1 元，满血值设得小时血条掉得更多，观感上理应更重
 *
 * 再乘上按扣费类型给的基准（缓存未命中 = 暴击最重），最后夹在固定区间内：
 * 下限保证小额扣费仍然看得见，上限避免大额扣费把特效炸出卡片可视区。
 *
 * @module @deepseek-ai/dsh-client-ui-token-monitor/client
 */
import type { TokenMonitorDamageEffectLevel } from '../../../../util/token-monitor-contract/src/index.ts'

export type DamageKind = 'normal' | 'miss' | 'output'

/**
 * 用户档位 → 倍率。0 是真正的关闭（不是「很小」）：调用方据此完全不渲染特效层，
 * 而不是画一个看不见的极小特效。
 */
const EFFECT_LEVEL_FACTOR: Record<TokenMonitorDamageEffectLevel, number> = {
  off: 0,
  subtle: 0.6,
  normal: 1,
  strong: 1.5,
  extreme: 2.2,
}

/** 档位在菜单里的中文名。 */
export const DAMAGE_EFFECT_LABELS: Record<TokenMonitorDamageEffectLevel, string> = {
  off: '关闭',
  subtle: '弱',
  normal: '标准',
  strong: '强',
  extreme: '极强',
}

/** 该档位是否彻底关闭扣血特效。 */
export function isDamageEffectOff(level: TokenMonitorDamageEffectLevel): boolean {
  return EFFECT_LEVEL_FACTOR[level] === 0
}

/** 把模型算出的倍率按用户档位缩放。 */
export function applyEffectLevel(magnitude: number, level: TokenMonitorDamageEffectLevel): number {
  return magnitude * (EFFECT_LEVEL_FACTOR[level] ?? 1)
}

/** 特效倍率的取值区间。 */
export const MIN_MAGNITUDE = 0.7
export const MAX_MAGNITUDE = 3

/** 金额与占比都用对数刻度：两者的实际取值都跨越好几个数量级。 */
const AMOUNT_LOG_RANGE = { lo: -3, hi: 0 } as const // ¥0.001 → ¥1
const FRACTION_LOG_RANGE = { lo: -4, hi: -1 } as const // 血条的万分之一 → 十分之一

/** 扣费类型自带的基准强度：暴击（缓存未命中）最重。 */
const KIND_BASE: Record<DamageKind, number> = { normal: 1, output: 1.15, miss: 1.5 }

/**
 * 强度的基准跨度：让最重的类型（暴击）在满强度时正好顶到 MAX_MAGNITUDE，
 * 于是 [MIN_MAGNITUDE, MAX_MAGNITUDE] 是真正取得到的区间，下面的 clamp 是兜底而不是装饰。
 */
const BASE_SPAN = MAX_MAGNITUDE / KIND_BASE.miss - MIN_MAGNITUDE

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

/** 把正数在其对数区间内归一到 0..1；区间外夹紧，非正数视为 0。 */
function logRamp(value: number, lo: number, hi: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0
  return clamp((Math.log10(value) - lo) / (hi - lo), 0, 1)
}

/**
 * 一次扣血（或回血）的特效倍率。
 * @param kind - 扣费类型，决定基准强度。
 * @param amount - 这一笔的金额（元）；未知或非正数时只按类型给基准值。
 * @param fraction - 这一笔占满血值的比例；回血时可传 0。
 */
export function damageMagnitude(kind: DamageKind, amount: number | undefined, fraction: number): number {
  const intensity = amount === undefined || !Number.isFinite(amount) || amount <= 0
    ? 0
    : Math.max(
      logRamp(amount, AMOUNT_LOG_RANGE.lo, AMOUNT_LOG_RANGE.hi),
      logRamp(fraction, FRACTION_LOG_RANGE.lo, FRACTION_LOG_RANGE.hi),
    )
  return clamp(KIND_BASE[kind] * (MIN_MAGNITUDE + intensity * BASE_SPAN), MIN_MAGNITUDE, MAX_MAGNITUDE)
}

/** 由倍率推出的具体视觉参数。 */
export interface DamageVisuals {
  magnitude: number
  /** 冲击环直径（px）。 */
  ringSize: number
  /** 单颗火花直径（px）。 */
  sparkSize: number
  /** 火花数量。 */
  sparkCount: number
  /** 血条抖动位移（px）。 */
  shakeAmplitude: number
  /** 血条抖动时长（ms）。 */
  shakeDuration: number
  /** 整条闪白的不透明度。 */
  flashOpacity: number
  /** 飘字字号（px）。 */
  floatFontSize: number
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

/** 把倍率展开成各处要用的像素与时长。所有输出都随 magnitude 单调不减。 */
export function damageVisuals(magnitude: number): DamageVisuals {
  const m = clamp(magnitude, MIN_MAGNITUDE, MAX_MAGNITUDE)
  return {
    magnitude: m,
    ringSize: Math.round(18 + m * 6),
    sparkSize: Math.round(2 + m * 1.3),
    sparkCount: Math.round(clamp(3 + m * 2.4, 4, 10)),
    shakeAmplitude: round(1.6 * m, 1),
    shakeDuration: Math.round(200 + m * 60),
    flashOpacity: round(0.12 + m * 0.13, 2),
    floatFontSize: Math.round(18 + (m - 1) * 3),
  }
}

/**
 * 从方向环上均匀取 count 个方向。直接截断前 N 个会让火花全挤在一侧，
 * 所以按索引等分采样。
 */
export function sampleDirections<T>(ring: readonly T[], count: number): T[] {
  const total = ring.length
  if (total === 0) return []
  const wanted = clamp(Math.round(count), 1, total)
  const picked: T[] = []
  for (let index = 0; index < wanted; index += 1) {
    const item = ring[Math.floor((index * total) / wanted)]
    if (item !== undefined) picked.push(item)
  }
  return picked
}
