/**
 * DeepSeek 峰谷定价价格表与计费引擎。
 * 价格表版本：2026-09-10（Flash 系列含 Vision-Exp 分时调价）。
 * 来源：https://api-docs.deepseek.com/zh-cn/quick_start/pricing/
 * 单位：元 / 百万 tokens。
 */

/** 单个时段的模型价格（DeepSeek 官方三字段）。 */
export interface ModelPrice {
  /** 输入（缓存未命中）价格。 */
  input: number
  /** 输入（缓存命中）价格。 */
  cacheHit: number
  /** 输出价格（已含 reasoning）。 */
  output: number
}

export interface PricingTable {
  models: Record<string, { peak: ModelPrice; offPeak: ModelPrice }>
  /** 高峰时段（北京时间，24 小时制半开区间），如 [[9, 12], [14, 18]]。 */
  peakHours: Array<[number, number]>
  /** 价格表版本，用于提示用户「价格已过期」。 */
  version: string
}

/** 2026-09-10 生效规则：V4.1 Flash 与两个旧名称共用新价；Pro 在 9-14 切换前保留原价。 */
export const PRICE_TABLE: PricingTable = {
  version: '2026-09-10',
  // 工作日高峰：北京时间 9:00-12:00、14:00-18:00；周末全天按低谷价。
  peakHours: [[9, 12], [14, 18]],
  models: {
    'deepseek-flash': {
      offPeak: { input: 1.0, cacheHit: 0.02, output: 4.0 },
      peak: { input: 2.0, cacheHit: 0.04, output: 8.0 },
    },
    // 图片由 API 按尺寸折算到 prompt_tokens，不能在插件层重复估算。
    'deepseek-v4-flash-vision-exp': {
      offPeak: { input: 1.0, cacheHit: 0.02, output: 4.0 },
      peak: { input: 2.0, cacheHit: 0.04, output: 8.0 },
    },
    'deepseek-v4-flash': {
      offPeak: { input: 1.0, cacheHit: 0.02, output: 4.0 },
      peak: { input: 2.0, cacheHit: 0.04, output: 8.0 },
    },
    'deepseek-v4-pro': {
      offPeak: { input: 4.5, cacheHit: 0.15, output: 13.5 },
      peak: { input: 9.0, cacheHit: 0.30, output: 27.0 },
    },
  },
}

/** 官网规定：9-14 12:00 起 Pro 请求按 Flash 价计费，直至未来 V4.1 Pro 上线另行更新。 */
const PRO_ROUTED_PRICE_TABLE: PricingTable = {
  ...PRICE_TABLE,
  version: '2026-09-14',
  models: { ...PRICE_TABLE.models, 'deepseek-v4-pro': PRICE_TABLE.models['deepseek-flash']! },
}

/**
 * 2026-08-17 00:00（北京时间）前的旧价格：统一价，无峰谷。
 * 峰值/谷值填同一组价格 + 空 peakHours，使 `isPeakHour` 恒为假、始终按 offPeak 计价。
 */
export const LEGACY_PRICE_TABLE: PricingTable = {
  version: 'legacy-before-2026-08-17',
  peakHours: [],
  models: {
    'deepseek-v4-flash-vision-exp': {
      offPeak: { input: 1.0, cacheHit: 0.02, output: 2.0 },
      peak: { input: 1.0, cacheHit: 0.02, output: 2.0 },
    },
    'deepseek-v4-flash': {
      offPeak: { input: 1.0, cacheHit: 0.02, output: 2.0 },
      peak: { input: 1.0, cacheHit: 0.02, output: 2.0 },
    },
    'deepseek-v4-pro': {
      offPeak: { input: 3.0, cacheHit: 0.025, output: 6.0 },
      peak: { input: 3.0, cacheHit: 0.025, output: 6.0 },
    },
  },
}

/** 2026-08-17 至 2026-09-10 12:00（北京时间）的旧峰谷价格。 */
export const PRE_FLASH_PRICE_TABLE: PricingTable = {
  version: '2026-08-23',
  peakHours: [[9, 12], [14, 18]],
  models: {
    'deepseek-v4-flash-vision-exp': { offPeak: { input: 1.5, cacheHit: 0.05, output: 4.5 }, peak: { input: 3, cacheHit: 0.1, output: 9 } },
    'deepseek-v4-flash': { offPeak: { input: 1.5, cacheHit: 0.05, output: 4.5 }, peak: { input: 3, cacheHit: 0.1, output: 9 } },
    'deepseek-v4-pro': { offPeak: { input: 4.5, cacheHit: 0.15, output: 13.5 }, peak: { input: 9, cacheHit: 0.3, output: 27 } },
  },
}

/**
 * 峰谷新价格生效时刻：2026-08-17 00:00 北京时间 = 2026-08-16 16:00 UTC。
 * 此前的调用按旧统一价计价，此后按峰谷价计价。
 */
const PEAK_PRICING_START = Date.UTC(2026, 7, 16, 16, 0, 0)
/** Flash 调价生效时刻：2026-09-10 12:00 北京时间 = 04:00 UTC。 */
export const FLASH_PRICING_START = Date.UTC(2026, 8, 10, 4, 0, 0)
/** Pro 转按 Flash 计费：2026-09-14 12:00 北京时间 = 04:00 UTC。 */
export const PRO_FLASH_PRICING_START = Date.UTC(2026, 8, 14, 4, 0, 0)

/** 默认价格按历史生效时间选择；显式自定义表保留原覆盖行为。 */
export function selectPriceTable(ts: number, table: PricingTable = PRICE_TABLE): PricingTable {
  if (ts < PEAK_PRICING_START) return LEGACY_PRICE_TABLE
  if (table !== PRICE_TABLE) return table
  if (ts < FLASH_PRICING_START) return PRE_FLASH_PRICE_TABLE
  if (ts >= PRO_FLASH_PRICING_START) return PRO_ROUTED_PRICE_TABLE
  return table
}

/** 单次调用的费用明细。 */
export interface CostBreakdown {
  costInput: number
  costCache: number
  costCacheRead: number
  costCacheWrite: number
  costOutput: number
  cost: number
  peak: boolean
}

/** DSH 内 DeepSeek 官方供应商的稳定 ID；只有该供应商具备计费资格。 */
export const OFFICIAL_PROVIDER_ID = 'deepseek-official'

/** provider + model 通过资格门禁后返回的价格表命中结果。 */
export interface PricingEligibility {
  provider: typeof OFFICIAL_PROVIDER_ID
  model: string
  matchedModel: string
  price: { peak: ModelPrice; offPeak: ModelPrice }
}

/** 取时间戳对应的北京时间小时（0-23）；解析失败返回 -1。 */
export function beijingHour(ts: number): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Shanghai',
    hour: '2-digit',
    hour12: false,
  }).formatToParts(new Date(ts))
  const hour = parts.find((p) => p.type === 'hour')?.value
  return hour === undefined ? -1 : Number(hour)
}

/** 取时间戳对应的北京时间星期（0=周日，6=周六）；解析失败返回 -1。 */
export function beijingWeekday(ts: number): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Shanghai',
    weekday: 'short',
  }).formatToParts(new Date(ts))
  const weekday = parts.find((p) => p.type === 'weekday')?.value
  return weekday === undefined ? -1 : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(weekday)
}

/** 工作日按原峰谷时段判断；周六、周日始终返回低谷。 */
export function isPeakHour(ts: number, peakHours: Array<[number, number]>): boolean {
  const weekday = beijingWeekday(ts)
  if (weekday === 0 || weekday === 6) return false
  const hour = beijingHour(ts)
  return peakHours.some(([start, end]) => hour >= start && hour < end)
}

/**
 * 归一化模型名后查价：直接命中优先，否则按最长前缀匹配。
 */
export function resolveModelPrice(
  model: string,
  table: PricingTable,
): { peak: ModelPrice; offPeak: ModelPrice } | undefined {
  const direct = table.models[model]
  if (direct !== undefined) return direct
  for (const [name, price] of Object.entries(table.models).sort(([a], [b]) => b.length - a.length)) {
    if (model.startsWith(`${name}-`)) return price
  }
  return undefined
}

/**
 * 计费资格统一入口：必须同时来自 DeepSeek 官方供应商并明确命中价格表。
 * 允许已登记模型的版本后缀按最长前缀匹配；未知模型不再按 Flash 猜价。
 */
export function resolvePricingEligibility(
  provider: string,
  model: string,
  ts: number,
  table: PricingTable = PRICE_TABLE,
): PricingEligibility | undefined {
  if (provider !== OFFICIAL_PROVIDER_ID || typeof model !== 'string') return undefined
  const active = selectPriceTable(ts, table)
  const entries = Object.entries(active.models).sort(([a], [b]) => b.length - a.length)
  const matched = entries.find(([name]) => model === name || model.startsWith(`${name}-`))
  if (matched === undefined) return undefined
  return { provider: OFFICIAL_PROVIDER_ID, model, matchedModel: matched[0], price: matched[1] }
}

/**
 * 按 (token 数, provider, 模型, 时间戳) 计算一次调用的费用。
 * 缓存命中（cacheReadTokens）按 cacheHit 价；缓存写入（cacheWriteTokens）并入缓存未命中价。
 * 未通过 provider + model 资格门禁时返回 undefined，调用方不得记录或展示费用。
 */
export function priceUsage(
  inputTokens: number,
  cacheReadTokens: number,
  cacheWriteTokens: number,
  outputTokens: number,
  provider: string,
  model: string,
  ts: number,
  table: PricingTable = PRICE_TABLE,
): CostBreakdown | undefined {
  if (![inputTokens, cacheReadTokens, cacheWriteTokens, outputTokens].every(value => Number.isSafeInteger(value) && value >= 0)) return undefined
  if (!Number.isSafeInteger(ts) || ts < 0) return undefined
  // 历史计价与资格判断使用同一时间段；settings 可显式覆盖默认峰谷价格。
  const active = selectPriceTable(ts, table)
  const eligibility = resolvePricingEligibility(provider, model, ts, table)
  if (eligibility === undefined) return undefined
  const peak = isPeakHour(ts, active.peakHours)
  const rate = peak ? eligibility.price.peak : eligibility.price.offPeak
  const costInput = (inputTokens / 1e6) * rate.input
  const costCacheRead = (cacheReadTokens / 1e6) * rate.cacheHit
  const costCacheWrite = (cacheWriteTokens / 1e6) * rate.input
  const costCache = costCacheRead + costCacheWrite
  const costOutput = (outputTokens / 1e6) * rate.output
  if (![costInput, costCacheRead, costCacheWrite, costCache, costOutput].every(value => Number.isFinite(value) && value >= 0)) return undefined
  const cost = costInput + costCache + costOutput
  if (!Number.isFinite(cost) || cost < 0) return undefined
  return {
    costInput,
    costCache,
    costCacheRead,
    costCacheWrite,
    costOutput,
    cost,
    peak,
  }
}
