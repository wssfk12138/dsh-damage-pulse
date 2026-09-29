/** Freeze exact model rules and CNY costs at collection time. */
import { createHash } from 'node:crypto'
import { emptyBillingRule, type BillingSnapshot, type BillingRules, type BillingModelRule, type BillingApplied } from '@deepseek-ai/dsh-token-monitor-contract'
import { OFFICIAL_PROVIDER_ID, PRICE_TABLE, isOfficialProvider, isStatutoryHoliday, type CostBreakdown, type PricingTable } from './pricing.ts'

/** Rule identity and settlement facts stored with each usage ledger record. */
/**
 * 官方峰谷口径的适用范围：DeepSeek 模型无论由官方供应商还是第三方接入，
 * 都在中国法定节假日整天空闲、工作日按配置窗口计高峰。
 */
function isDeepseekBillingModel(provider: string, model: string): boolean {
  return isOfficialProvider(provider) || /deepseek/i.test(model)
}

export interface BillingDecision extends CostBreakdown {
  billingStatus: 'priced' | 'unpriced' | 'disabled'
  billingRuleVersion: number
  modelMultiplier: number
  billingRule?: BillingModelRule
  billingApplied?: BillingApplied
  billingReason?: 'provider-disabled' | 'model-disabled' | 'rule-missing' | 'rate-missing' | 'invalid-usage'
}

/** Seed official exact model ids from the installed source-cited table.
 * @param table Existing deployment price override.
 * @returns Editable Host defaults.
 */
export function defaultBillingRules(table: PricingTable = PRICE_TABLE): BillingRules {
  const periods = table.peakHours.map(([start, end]) => ({ days: [1, 2, 3, 4, 5], start: start * 60, end: end * 60 }))
  const fromPrice = (model: string, price: { input: number; cacheHit: number; output: number }): BillingModelRule => ({ ...emptyBillingRule(model), mode: 'peak', peak: { ...price }, offPeak: { ...price }, periods: structuredClone(periods) })
  const deepseek = Object.entries(table.models).map(([model, price]) => ({ ...emptyBillingRule(model), mode: 'peak' as const, peak: { ...price.peak }, offPeak: { ...price.offPeak }, periods: structuredClone(periods) }))
  const openaiPrices: Record<string, { input: number; cacheHit: number; output: number }> = {
    'gpt-5.4': { input: 2.5, cacheHit: 0.25, output: 15 },
    'gpt-5.4-mini': { input: 0.75, cacheHit: 0.075, output: 4.5 },
    'gpt-5.5': { input: 5, cacheHit: 0.5, output: 30 },
    'gpt-5.6-luna': { input: 2, cacheHit: 0.2, output: 12 },
    'gpt-5.6-sol': { input: 5, cacheHit: 0.5, output: 30 },
    'gpt-5.6-terra': { input: 2, cacheHit: 0.2, output: 12 },
    'gpt-6-astra': { input: 10, cacheHit: 1, output: 50 },
  }
  const zhipuPrices: Record<string, { input: number; cacheHit: number; output: number }> = {
    'glm-5': { input: 4, cacheHit: 1, output: 18 },
    'glm-5-turbo': { input: 5, cacheHit: 1.2, output: 22 },
    'glm-5.1': { input: 3.6, cacheHit: 0.78, output: 14.4 },
    'glm-5.2': { input: 5.6, cacheHit: 1.4, output: 19.6 },
    'glm-5.3': { input: 6.4, cacheHit: 1.6, output: 22.4 },
    'glm-5.3-flash': { input: 0.4, cacheHit: 0.115, output: 1.4 },
  }
  const zhipuTiers: Record<string, Array<{ maxInputTokens: number | null; input: number; cacheHit: number; output: number }>> = {
    'glm-5': [{ maxInputTokens: 32_000, input: 4, cacheHit: 1, output: 18 }, { maxInputTokens: null, input: 6, cacheHit: 1, output: 22 }],
    'glm-5-turbo': [{ maxInputTokens: 32_000, input: 5, cacheHit: 1.2, output: 22 }, { maxInputTokens: null, input: 7, cacheHit: 1.2, output: 26 }],
    'glm-5.1': [{ maxInputTokens: 32_000, input: 3.6, cacheHit: 0.78, output: 14.4 }, { maxInputTokens: null, input: 4.8, cacheHit: 0.78, output: 16.8 }],
  }
  const kimi = { 'kimi-k3': { input: 19, cacheHit: 1.9, output: 95 } }
  const rules: BillingRules = { version: 1, providers: [
    { provider: 'deepseek-official', enabled: true, models: deepseek },
    { provider: 'openai', enabled: true, models: Object.entries(openaiPrices).map(([model, price]) => fromPrice(model, price)) },
    { provider: 'zhipu', enabled: true, models: Object.entries(zhipuPrices).map(([model, price]) => ({ ...fromPrice(model, price), ...(zhipuTiers[model] ? { tiers: zhipuTiers[model].map(tier => ({ ...tier })) } : {}) })) },
    { provider: 'kimi', enabled: true, models: Object.entries(kimi).map(([model, price]) => fromPrice(model, price)) },
  ] }
  for (const provider of rules.providers) for (const rule of provider.models) {
    rule.source = { templateId: `${provider.provider}/${rule.model}`, version: isOfficialProvider(provider.provider) ? table.version : 'legacy-2026-09-15',
      name: 'Installed pricing table', ...(isOfficialProvider(provider.provider) ? { url: 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing/' } : {}),
      verifiedAt: null, originalCurrency: isOfficialProvider(provider.provider) ? 'CNY' : 'unknown', originalUnit: 'per million tokens',
      conversionBasis: isOfficialProvider(provider.provider) ? 'CNY; no conversion' : 'Legacy numeric values interpreted as CNY; original currency and conversion not verified', modified: false }
  }
  return rules
}

/** Select tiers by total input context and charge disjoint categories; image input is already included.
 * @param snapshot Validated Host configuration and revision.
 * @param usage Disjoint token counts.
 * @param provider Exact provider id.
 * @param model Exact model id.
 * @param timestamp Settlement time.
 * @returns Frozen costs and explicit billing state.
 */
export function billUsage(snapshot: BillingSnapshot, usage: { inputTokens: number; cacheReadTokens: number; cacheWriteTokens: number; outputTokens: number }, provider: string, model: string, timestamp: number): BillingDecision {
  // 账号路由与 API key 路由共用同一套官方价格；旧快照只有官方条目时按别名回退。
  const owner = snapshot.rules.providers.find(item => item.provider === provider)
    ?? (isOfficialProvider(provider) ? snapshot.rules.providers.find(item => item.provider === OFFICIAL_PROVIDER_ID) : undefined)
  const rule = owner?.models.find(item => item.model === model)
  const result: BillingDecision = { cost: 0, costInput: 0, costCache: 0, costCacheRead: 0, costCacheWrite: 0, costOutput: 0, peak: false, billingStatus: 'unpriced', billingRuleVersion: snapshot.revision, modelMultiplier: rule?.multiplier ?? 1, ...(rule ? { billingRule: structuredClone(rule) } : {}) }
  if (owner?.enabled === false || rule?.enabled === false) return { ...result, billingStatus: 'disabled', billingReason: owner?.enabled === false ? 'provider-disabled' : 'model-disabled' }
  if (!rule) return { ...result, billingReason: 'rule-missing' }
  const date = new Date(timestamp + 8 * 3600_000)
  const minute = date.getUTCHours() * 60 + date.getUTCMinutes()
  const statutoryHoliday = isDeepseekBillingModel(provider, rule.model) && isStatutoryHoliday(timestamp)
  const peak = rule.mode === 'peak' && !statutoryHoliday && rule.periods.some(period => period.days.includes(date.getUTCDay()) && minute >= period.start && minute < period.end)
  const baseRate = rule.mode === 'fixed' ? rule.fixed : peak ? rule.peak : rule.offPeak
  const contextTokens = usage.inputTokens + usage.cacheReadTokens + usage.cacheWriteTokens
  const tiers = rule.mode === 'fixed' ? rule.tiers : (peak ? rule.peakTiers : rule.offPeakTiers) ?? rule.tiers
  const tier = tiers?.find(item => item.maxInputTokens === null || contextTokens <= item.maxInputTokens)
  const selectedRate = tier ?? baseRate
  const rate = { input: selectedRate.input, cacheHit: selectedRate.cacheHit, output: selectedRate.output, cacheWrite: selectedRate.cacheWrite === undefined || selectedRate.cacheWrite === 'input' ? selectedRate.input : selectedRate.cacheWrite }
  const ruleJson = JSON.stringify([provider, rule], (_key, value: unknown) => value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))) : value)
  result.billingApplied = { ruleId: createHash('sha256').update(ruleJson).digest('hex'),
    mode: rule.mode === 'fixed' ? 'fixed' : peak ? 'peak' : 'offPeak', ...(tier ? { tierMax: tier.maxInputTokens } : {}), rate }
  if (Object.values(rate).every(value => value === null) || (usage.inputTokens > 0 && rate.input === null) || (usage.cacheWriteTokens > 0 && rate.cacheWrite === null) || (usage.cacheReadTokens > 0 && rate.cacheHit === null) || (usage.outputTokens > 0 && rate.output === null)) return { ...result, peak, billingReason: 'rate-missing' }
  const costInput = usage.inputTokens / 1e6 * (rate.input ?? 0) * rule.multiplier
  const costCacheRead = usage.cacheReadTokens / 1e6 * (rate.cacheHit ?? 0) * rule.multiplier
  const costCacheWrite = usage.cacheWriteTokens / 1e6 * (rate.cacheWrite ?? 0) * rule.multiplier
  const costOutput = usage.outputTokens / 1e6 * (rate.output ?? 0) * rule.multiplier
  const costCache = costCacheRead + costCacheWrite, cost = costInput + costCache + costOutput
  if (![cost, timestamp, ...Object.values(usage)].every(Number.isFinite)) return { ...result, peak, billingReason: 'invalid-usage' }
  return { ...result, costInput, costCacheRead, costCacheWrite, costOutput, costCache, cost, peak, billingStatus: 'priced' }
}
