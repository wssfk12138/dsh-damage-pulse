/**
 * DeepSeek 峰谷定价价格表与计费引擎。
 * 价格表版本：2026-09-13（Flash 系列含 Vision-Exp 分时调价；V4 Pro 计费方式不变）。
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

/** 2026-09-10 生效规则：V4.1 Flash 与两个旧名称共用新价；V4 Pro 计费方式不变（官网已取消 9-14 起按 Flash 价计费）。 */
export const PRICE_TABLE: PricingTable = {
  version: '2026-09-27',
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

/**
 * 节假日并入空闲时段的生效时刻：官方 2026-09-25 起执行
 * （北京时间 2026-09-25 00:00 = 2026-09-24 16:00 UTC）。
 * 之前的调用按原规则（工作日峰谷窗口 + 周末空闲）计算，历史重算不得回改。
 */
export const STATUTORY_HOLIDAY_PRICING_START = Date.UTC(2026, 8, 24, 16, 0, 0)

/** 默认价格按历史生效时间选择；显式自定义表保留原覆盖行为。 */
export function selectPriceTable(ts: number, table: PricingTable = PRICE_TABLE): PricingTable {
  if (ts < PEAK_PRICING_START) return LEGACY_PRICE_TABLE
  if (table !== PRICE_TABLE) return table
  if (ts < FLASH_PRICING_START) return PRE_FLASH_PRICE_TABLE
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

/** DSH 内 DeepSeek 官方供应商的稳定 ID；官方计费路由的身份见 OFFICIAL_PROVIDER_IDS。 */
export const OFFICIAL_PROVIDER_ID = 'deepseek-official'

/** DeepSeek 官方计费路由的全部 provider id；API key 路由与账号路由价格口径相同。 */
export const OFFICIAL_PROVIDER_IDS = [OFFICIAL_PROVIDER_ID, 'deepseek-account'] as const

/** provider 是否走 DeepSeek 官方计费路由（含 0.2.0 起的账号路由）。 */
export function isOfficialProvider(provider: string): boolean {
  return (OFFICIAL_PROVIDER_IDS as readonly string[]).includes(provider)
}

/** 两个 provider 是否属于同一计费族（官方 API key 路由与账号路由同族）。
 * @param left - 调用方给出的 provider；缺省或空串表示不按 provider 过滤。
 * @param right - 记录自身携带的 provider。
 * @returns 是否按同族对待。
 */
export function sameProviderFamily(left: string | null | undefined, right: string): boolean {
  if (left === null || left === undefined || left === '') return true
  return left === right || (isOfficialProvider(left) && isOfficialProvider(right))
}

/** 展示用的稳定 provider id：官方族成员统一落到 OFFICIAL_PROVIDER_ID。
 * @param provider - 记录或规则里携带的 provider。
 * @returns 同族统一后的展示 id。
 */
export function displayProviderId(provider: string): string {
  return isOfficialProvider(provider) ? OFFICIAL_PROVIDER_ID : provider
}

/** provider + model 通过资格门禁后返回的价格表命中结果。 */
export interface PricingEligibility {
  provider: string
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

/**
 * 中国法定节假日（北京时间日期，YYYY-MM-DD）。
 *
 * 官方计费说明：北京时间周一至周五（不含中国法定节假日）9:00 - 12:00、14:00 - 18:00
 * 为高峰时段；其余时段，包括周末及中国法定节假日全天均为空闲时段。
 * 来源：https://api-docs.deepseek.com/zh-cn/quick_start/pricing/
 * 数据：国务院办公厅 2026 年部分节假日安排。该年度的调休上班日（2026-01-04、02-14、
 * 02-28、05-09、09-20、10-10）按官方口径仍属「周一至周五」之外，因此不收进本表；
 * 新年度安排公布后需要同步更新，未收录的年份按周末规则处理。
 */
export const CHINA_STATUTORY_HOLIDAYS: ReadonlySet<string> = new Set([
  '2026-01-01', '2026-01-02', '2026-01-03',
  '2026-02-15', '2026-02-16', '2026-02-17', '2026-02-18', '2026-02-19', '2026-02-20', '2026-02-21', '2026-02-22', '2026-02-23',
  '2026-04-04', '2026-04-05', '2026-04-06',
  '2026-05-01', '2026-05-02', '2026-05-03', '2026-05-04', '2026-05-05',
  '2026-06-19', '2026-06-20', '2026-06-21',
  '2026-09-25', '2026-09-26', '2026-09-27',
  '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07',
])

/** 取时间戳对应的北京时间日期（YYYY-MM-DD）；解析失败返回空串。 */
export function beijingDate(ts: number): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(ts))
  const pick = (type: string) => parts.find((p) => p.type === type)?.value
  const year = pick('year'); const month = pick('month'); const day = pick('day')
  return year === undefined || month === undefined || day === undefined ? '' : `${year}-${month}-${day}`
}

/**
 * 是否为北京时间当天的中国法定节假日；未收录年份、解析失败或早于生效时刻返回 false。
 * @param ts - Epoch timestamp in milliseconds.
 * @param holidays - Beijing-time statutory holiday dates.
 * @returns True when the timestamp lands on a statutory holiday inside the effective window.
 */
export function isStatutoryHoliday(ts: number, holidays: ReadonlySet<string> = CHINA_STATUTORY_HOLIDAYS): boolean {
  if (ts < STATUTORY_HOLIDAY_PRICING_START) return false
  const date = beijingDate(ts)
  return date !== '' && holidays.has(date)
}

/**
 * 高峰时段判定：周一至周五（不含中国法定节假日）按配置窗口为高峰；
 * 周末与中国法定节假日全天为空闲时段。
 */
export function isPeakHour(
  ts: number,
  peakHours: Array<[number, number]>,
  holidays: ReadonlySet<string> = CHINA_STATUTORY_HOLIDAYS,
): boolean {
  const weekday = beijingWeekday(ts)
  if (weekday === 0 || weekday === 6) return false
  if (isStatutoryHoliday(ts, holidays)) return false
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
  if (!isOfficialProvider(provider) || typeof model !== 'string') return undefined
  const active = selectPriceTable(ts, table)
  const entries = Object.entries(active.models).sort(([a], [b]) => b.length - a.length)
  const matched = entries.find(([name]) => model === name || model.startsWith(`${name}-`))
  if (matched === undefined) return undefined
  // 账号路由与 API key 路由统一按官方身份落账：概览、计费规则与投影都按同一族取数，
  // 否则账号路由下悬浮卡片的用量概览会查不到历史记录而显示「未记录」。
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
