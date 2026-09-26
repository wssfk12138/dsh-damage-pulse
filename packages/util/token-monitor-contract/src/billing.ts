/** Browser-safe, Host-global billing configuration. Rates are CNY per million tokens. */
export interface BillingPrice {
  input: number | null
  cacheHit: number | null
  /** Omitted legacy values and 'input' inherit the uncached-input rate. */
  cacheWrite?: number | null | 'input'
  output: number | null
}

/** Inclusive total-input ceiling; null marks the final open-ended tier. */
export interface BillingTier extends BillingPrice {
  maxInputTokens: number | null
}

/** Half-open Beijing-time minute interval. Sunday is day zero. */
export interface BillingPeriod { days: number[]; start: number; end: number }

/** Exact provider/model rules never fall back to another model's price. */
export interface BillingModelRule {
  model: string
  enabled: boolean
  multiplier: number
  mode: 'fixed' | 'peak'
  fixed: BillingPrice
  peak: BillingPrice
  offPeak: BillingPrice
  periods: BillingPeriod[]
  tiers?: BillingTier[]
  /** Omitted period tiers retain legacy shared tiers; an empty list uses the period base price. */
  peakTiers?: BillingTier[]
  offPeakTiers?: BillingTier[]
  source?: BillingSource
}

/** Retained template attribution; a missing verification date makes no freshness claim. */
export interface BillingSource {
  templateId: string
  version: string
  name: string
  url?: string
  verifiedAt: string | null
  effectiveAt?: string
  originalCurrency: string
  originalUnit: string
  conversionBasis: string
  modified: boolean
}

/** Settlement facts, frozen independently of the current settings revision. */
export interface BillingApplied {
  ruleId: string
  mode: 'fixed' | 'peak' | 'offPeak'
  tierMax?: number | null
  rate: BillingPrice
}

/** Version belongs to the wire format; revision belongs to the settings owner. */
export interface BillingRules {
  version: 1
  providers: Array<{ provider: string; enabled: boolean; models: BillingModelRule[] }>
}

/** Saved snapshot used for optimistic concurrency and recorded rule versions. */
export interface BillingSnapshot { revision: number; rules: BillingRules }

/** Normalize an empty multiplier; reject zero, negative and non-finite values.
 * @param value Numeric multiplier or empty editor value.
 * @returns Positive multiplier.
 */
export function normalizeMultiplier(value: unknown): number {
  if (value === '' || value === undefined || value === null) return 1
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) throw new TypeError('Invalid model multiplier')
  return value
}

function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Expected object')
  const row = value as Record<string, unknown>
  if (Object.keys(row).some(key => !keys.includes(key))) throw new TypeError('Unknown billing field')
  return row
}
function bool(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new TypeError('Expected boolean')
  return value
}
function id(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 512) throw new TypeError('Invalid billing identifier')
  return value
}
function price(value: unknown): BillingPrice {
  const row = object(value, ['input', 'cacheHit', 'cacheWrite', 'output'])
  for (const [key, item] of Object.entries(row)) {
    if (key === 'cacheWrite' && item === 'input') continue
    if (item !== null && (typeof item !== 'number' || !Number.isFinite(item) || item < 0 || item > 1e9)) throw new TypeError('Invalid unit price')
  }
  if (!['input', 'cacheHit', 'output'].every(key => key in row)) throw new TypeError('Missing price field')
  return { input: row.input as number | null, cacheHit: row.cacheHit as number | null, output: row.output as number | null, ...('cacheWrite' in row ? { cacheWrite: row.cacheWrite as Exclude<BillingPrice['cacheWrite'], undefined> } : {}) }
}
function source(value: unknown): BillingSource {
  const row = object(value, ['templateId', 'version', 'name', 'url', 'verifiedAt', 'effectiveAt', 'originalCurrency', 'originalUnit', 'conversionBasis', 'modified'])
  const date = (value: unknown) => {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) throw new TypeError('Invalid source date')
    return value
  }
  const url = row.url === undefined ? undefined : id(row.url)
  if (url && !/^https?:\/\//i.test(url)) throw new TypeError('Invalid source URL')
  return { templateId: id(row.templateId), version: id(row.version), name: id(row.name),
    ...(url ? { url } : {}), verifiedAt: row.verifiedAt === null ? null : date(row.verifiedAt),
    ...(row.effectiveAt === undefined ? {} : { effectiveAt: date(row.effectiveAt) }),
    originalCurrency: id(row.originalCurrency), originalUnit: id(row.originalUnit),
    conversionBasis: id(row.conversionBasis), modified: bool(row.modified) }
}
function unique<T>(values: T[], key: (value: T) => string): T[] {
  if (new Set(values.map(key)).size !== values.length) throw new TypeError('Duplicate billing identifier')
  return values
}

/** Read frozen settlement rates from durable records.
 * @param value Decoded ledger field.
 * @returns Validated settlement facts with resolved cache-write pricing.
 */
export function validateBillingApplied(value: unknown): BillingApplied {
  const row = object(value, ['ruleId', 'mode', 'tierMax', 'rate'])
  if (typeof row.ruleId !== 'string' || !/^[a-f0-9]{64}$/.test(row.ruleId)) throw new TypeError('Invalid rule identity')
  if (row.mode !== 'fixed' && row.mode !== 'peak' && row.mode !== 'offPeak') throw new TypeError('Invalid settlement mode')
  if (row.tierMax !== undefined && row.tierMax !== null && (!Number.isSafeInteger(row.tierMax) || (row.tierMax as number) <= 0)) throw new TypeError('Invalid settled tier')
  const rate = price(row.rate)
  if (rate.cacheWrite === undefined || rate.cacheWrite === 'input') throw new TypeError('Unresolved cache-write rate')
  return { ruleId: row.ruleId, mode: row.mode, ...(row.tierMax === undefined ? {} : { tierMax: row.tierMax as number | null }), rate }
}

/** Validate and copy a complete configuration from disk or HTTP.
 * @param value Untrusted decoded JSON.
 * @returns Canonical configuration with normalized multipliers.
 */
export function validateBillingRules(value: unknown): BillingRules {
  const row = object(value, ['version', 'providers'])
  if (row.version !== 1 || !Array.isArray(row.providers) || row.providers.length > 500) throw new TypeError('Invalid billing version or providers')
  return { version: 1, providers: unique(row.providers.map((value) => {
    const provider = object(value, ['provider', 'enabled', 'models'])
    if (!Array.isArray(provider.models) || provider.models.length > 5000) throw new TypeError('Invalid models')
    return { provider: id(provider.provider), enabled: bool(provider.enabled), models: unique(provider.models.map((value) => {
      const model = object(value, ['model', 'enabled', 'multiplier', 'mode', 'fixed', 'peak', 'offPeak', 'periods', 'tiers', 'peakTiers', 'offPeakTiers', 'source'])
      if (model.mode !== 'fixed' && model.mode !== 'peak') throw new TypeError('Invalid price mode')
      if (!Array.isArray(model.periods) || model.periods.length > 50) throw new TypeError('Invalid peak periods')
      const periods = model.periods.map((value) => {
        const period = object(value, ['days', 'start', 'end'])
        if (!Array.isArray(period.days) || !period.days.length || period.days.some(day => !Number.isInteger(day) || day < 0 || day > 6)) throw new TypeError('Invalid weekdays')
        if (!Number.isInteger(period.start) || !Number.isInteger(period.end) || (period.start as number) < 0 || (period.end as number) > 1440 || (period.start as number) >= (period.end as number)) throw new TypeError('Invalid peak interval')
        return { days: [...new Set(period.days as number[])], start: period.start as number, end: period.end as number }
      })
      const tierFields: Partial<Pick<BillingModelRule, 'tiers' | 'peakTiers' | 'offPeakTiers'>> = {}
      for (const key of ['tiers', 'peakTiers', 'offPeakTiers'] as const) {
        const values = model[key]
        if (values === undefined) continue
        if (!Array.isArray(values) || values.length > 50) throw new TypeError('Invalid price tiers')
        let previous = 0
        const tiers = values.map((value, index, values) => {
          const tier = object(value, ['maxInputTokens', 'input', 'cacheHit', 'cacheWrite', 'output'])
          const max = tier.maxInputTokens
          if (max === null && index !== values.length - 1) throw new TypeError('Invalid price tier boundary')
          if (max !== null && (!Number.isSafeInteger(max) || (max as number) <= previous)) throw new TypeError('Invalid price tier boundary')
          previous = max === null ? Number.MAX_SAFE_INTEGER : max as number
          const { maxInputTokens: _max, ...rates } = tier
          return { maxInputTokens: max as number | null, ...price(rates) }
        })
        if (tiers.length > 0 && tiers.at(-1)?.maxInputTokens !== null) throw new TypeError('Final price tier must be open ended')
        tierFields[key] = tiers
      }
      return {
        model: id(model.model), enabled: bool(model.enabled), multiplier: normalizeMultiplier(model.multiplier), mode: model.mode,
        fixed: price(model.fixed), peak: price(model.peak), offPeak: price(model.offPeak), periods, ...tierFields,
        ...(model.source === undefined ? {} : { source: source(model.source) }),
      } satisfies BillingModelRule
    }), rule => rule.model) }
  }), rule => rule.provider) }
}

/** Create an editable, unpriced model rule.
 * @param model Exact catalog model identifier.
 * @returns Independent draft.
 */
export function emptyBillingRule(model: string): BillingModelRule {
  return { model, enabled: true, multiplier: 1, mode: 'fixed', fixed: { input: null, cacheHit: null, output: null }, peak: { input: null, cacheHit: null, output: null }, offPeak: { input: null, cacheHit: null, output: null }, periods: [{ days: [1,2,3,4,5], start: 540, end: 720 }, { days: [1,2,3,4,5], start: 840, end: 1080 }], tiers: [] }
}
