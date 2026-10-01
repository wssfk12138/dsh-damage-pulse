import { describe, expect, it } from 'vitest'
import { billUsage, defaultBillingRules } from '../src/billing.ts'
import { resolveBillingProvider } from '../src/billing-rule-resolution.ts'
import type { BillingSnapshot } from '@deepseek-ai/dsh-token-monitor-contract'
import { validateBillingRules } from '@deepseek-ai/dsh-token-monitor-contract'

const snapshot = (overrides: Record<string, unknown> = {}) => ({ revision: 7, rules: { version: 1, providers: [{ provider: 'vendor', enabled: true, models: [{ model: 'vision', enabled: true, multiplier: 2, mode: 'peak', fixed: { input: 1, cacheHit: 2, output: 3 }, peak: { input: 10, cacheHit: 20, output: 30 }, offPeak: { input: 4, cacheHit: 5, output: 6 }, periods: [{ days: [1], start: 540, end: 720 }] }] }] }, ...overrides }) as unknown as BillingSnapshot

describe('custom billing', () => {
  it.each(['fixed', 'peak', 'offPeak'] as const)('charges independent cache writes for %s base prices and tiers', (mode) => {
    const saved = snapshot(), rule = saved.rules.providers[0]!.models[0]!
    rule.mode = mode === 'fixed' ? 'fixed' : 'peak'
    const time = Date.parse(mode === 'offPeak' ? '2026-09-14T12:00:00+08:00' : '2026-09-14T10:00:00+08:00')
    const usage = { inputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 1_000_000, outputTokens: 0 }
    const run = () => billUsage(saved, usage, 'vendor', 'vision', time)
    const price = rule[mode]
    price.cacheWrite = 7
    expect(run()).toMatchObject({ costCacheWrite: 14, cost: 14, billingApplied: { mode, rate: { cacheWrite: 7 } } })
    price.cacheWrite = 0
    expect(run()).toMatchObject({ billingStatus: 'priced', cost: 0 })
    price.cacheWrite = null
    expect(run()).toMatchObject({ billingStatus: 'unpriced', billingReason: 'rate-missing' })
    price.cacheWrite = 'input'
    expect(run().costCacheWrite).toBe(price.input! * 2)
    delete price.cacheWrite
    expect(run().costCacheWrite).toBe(price.input! * 2)
    rule[mode === 'fixed' ? 'tiers' : mode === 'peak' ? 'peakTiers' : 'offPeakTiers'] = [{ maxInputTokens: null, input: 11, cacheHit: 1, cacheWrite: 9, output: 12 }]
    expect(run()).toMatchObject({ costCacheWrite: 18, billingApplied: { tierMax: null, rate: { cacheWrite: 9 } } })
  })

  it('keeps the rule identity across canonical reload and freezes rates before later edits', () => {
    const saved = snapshot(), usage = { inputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 1, outputTokens: 0 }, time = Date.parse('2026-09-14T10:00:00+08:00')
    const first = billUsage(saved, usage, 'vendor', 'vision', time)
    const reloaded = { revision: saved.revision + 1, rules: validateBillingRules(JSON.parse(JSON.stringify(saved.rules))) }
    expect(billUsage(reloaded, usage, 'vendor', 'vision', time).billingApplied?.ruleId).toBe(first.billingApplied?.ruleId)
    reloaded.rules.providers[0]!.models[0]!.peak.input = 99
    expect(billUsage(reloaded, usage, 'vendor', 'vision', time).billingApplied?.ruleId).not.toBe(first.billingApplied?.ruleId)
    expect(first.billingApplied?.rate).toEqual({ input: 10, cacheHit: 20, cacheWrite: 10, output: 30 })
  })
  it('selects separate peak and off-peak tiers at exact Beijing boundaries', () => {
    const saved = snapshot()
    const rule = saved.rules.providers[0]!.models[0]!
    Object.assign(rule, {
      tiers: [{ maxInputTokens: null, input: 99, cacheHit: 99, output: 99 }],
      peakTiers: [{ maxInputTokens: 100, input: 10, cacheHit: 1, output: 30 }, { maxInputTokens: null, input: 20, cacheHit: 2, output: 60 }],
      offPeakTiers: [{ maxInputTokens: 200, input: 4, cacheHit: 0.5, output: 6 }, { maxInputTokens: null, input: 8, cacheHit: 1, output: 12 }],
    })
    const usage = { inputTokens: 1, cacheReadTokens: 99, cacheWriteTokens: 1, outputTokens: 1_000_000 }
    const run = (time: string) => billUsage(saved, usage, 'vendor', 'vision', Date.parse(time))
    expect(run('2026-09-14T09:00:00+08:00')).toMatchObject({ peak: true, costOutput: 120 })
    expect(run('2026-09-14T09:00:00+08:00').costInput).toBeCloseTo(0.00004, 12)
    expect(run('2026-09-14T12:00:00+08:00')).toMatchObject({ peak: false, costOutput: 12 })
    expect(run('2026-09-20T10:00:00+08:00')).toMatchObject({ peak: false, costOutput: 12 })
    Object.assign(rule, { peakTiers: [] })
    expect(run('2026-09-14T09:00:00+08:00').costOutput).toBe(60)
    rule.mode = 'fixed'
    expect(run('2026-09-14T09:00:00+08:00').costOutput).toBe(198)
  })

  it('charges disjoint input, cache and output once with multiplier', () => {
    const result = billUsage(snapshot(), { inputTokens: 1_000_000, cacheReadTokens: 2_000_000, cacheWriteTokens: 3_000_000, outputTokens: 4_000_000 }, 'vendor', 'vision', Date.parse('2026-09-14T10:00:00+08:00'))
    expect(result).toMatchObject({ billingStatus: 'priced', costInput: 20, costCacheRead: 80, costCacheWrite: 60, costOutput: 240, cost: 400, peak: true })
  })

  it('uses input tokens for image requests without an extra image fee', () => {
    const result = billUsage(snapshot(), { inputTokens: 1_000_000, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 }, 'vendor', 'vision', Date.parse('2026-09-14T10:00:00+08:00'))
    expect(result.cost).toBe(20)
  })

  it('retains unpriced and disabled status with zero cost', () => {
    expect(billUsage(snapshot(), { inputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 }, 'vendor', 'missing', Date.now()).billingStatus).toBe('unpriced')
    expect(billUsage(snapshot({ rules: { version: 1, providers: [{ provider: 'vendor', enabled: false, models: [] }] } }), { inputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 }, 'vendor', 'missing', Date.now()).billingStatus).toBe('disabled')
  })

  it('freezes the selected price and multiplier in the decision snapshot', () => {
    const first = billUsage(snapshot(), { inputTokens: 1_000_000, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 }, 'vendor', 'vision', Date.parse('2026-09-14T10:00:00+08:00'))
    const changed = snapshot({ revision: 8, rules: { version: 1, providers: [{ provider: 'vendor', enabled: true, models: [{ model: 'vision', enabled: true, multiplier: 9, mode: 'fixed', fixed: { input: 99, cacheHit: 99, output: 99 }, peak: { input: null, cacheHit: null, output: null }, offPeak: { input: null, cacheHit: null, output: null }, periods: [] }] }] } })
    const second = billUsage(changed, { inputTokens: 1_000_000, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 }, 'vendor', 'vision', Date.parse('2026-09-14T10:00:00+08:00'))
    expect(first.billingRule?.multiplier).toBe(2)
    expect(first.cost).toBe(20)
    expect(second.cost).toBe(891)
    expect(first.cost).not.toBe(second.cost)
  })

  it('selects context tiers by input token count before applying multiplier', () => {
    const rules = snapshot().rules
    rules.providers[0]!.models[0]!.tiers = [
      { maxInputTokens: 272_000, input: 10, cacheHit: 1, output: 30 },
      { maxInputTokens: null, input: 20, cacheHit: 2, output: 60 },
    ]
    const low = billUsage({ revision: 1, rules }, { inputTokens: 272_000, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 1_000_000 }, 'vendor', 'vision', Date.parse('2026-09-14T10:00:00+08:00'))
    const high = billUsage({ revision: 1, rules }, { inputTokens: 273_000, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 1_000_000 }, 'vendor', 'vision', Date.parse('2026-09-14T10:00:00+08:00'))
    expect(low.costInput).toBeCloseTo(5.44, 10)
    expect(low.costOutput).toBe(60)
    expect(low.cost).toBeCloseTo(65.44, 10)
    expect(high.costInput).toBeCloseTo(10.92, 10)
    expect(high.costOutput).toBe(120)
    expect(high.cost).toBeCloseTo(130.92, 10)
  })

  it('counts cached input toward the context tier without charging it as uncached input', () => {
    const rules = snapshot().rules
    rules.providers[0]!.models[0]!.tiers = [
      { maxInputTokens: 272_000, input: 10, cacheHit: 1, output: 30 },
      { maxInputTokens: null, input: 20, cacheHit: 2, output: 60 },
    ]
    const decision = billUsage({ revision: 1, rules }, {
      inputTokens: 1_000, cacheReadTokens: 270_000, cacheWriteTokens: 2_000, outputTokens: 1_000,
    }, 'vendor', 'vision', Date.parse('2026-09-14T10:00:00+08:00'))
    expect(decision).toMatchObject({ billingStatus: 'priced', costInput: 0.04, costCacheRead: 1.08, costCacheWrite: 0.08, costOutput: 0.12 })
    expect(decision.cost).toBeCloseTo(1.32, 10)
  })

  it('seeds the supported provider templates without pricing empty providers', () => {
    const rules = defaultBillingRules()
    expect(rules.providers.map(provider => provider.provider)).toEqual(['deepseek-official', 'openai', 'zhipu', 'kimi'])
    // 账号路由与 API key 路由同族，因此不再单独播下一条重复的供应商记录（界面上不会出现两行 DeepSeek）；
    // 账号调用的计价由 billUsage 的官方族回退负责，见下一个用例。
    expect(rules.providers.find(provider => provider.provider === 'deepseek-account')).toBeUndefined()
    expect(rules.providers.find(provider => provider.provider === 'openai')?.models.find(model => model.model === 'gpt-5.4')?.fixed).toEqual({ input: null, cacheHit: null, output: null })
    expect(rules.providers.find(provider => provider.provider === 'openai')?.models.find(model => model.model === 'gpt-5.4')?.peak).toEqual({ input: 2.5, cacheHit: 0.25, output: 15 })
    expect(rules.providers.find(provider => provider.provider === 'hunyuan')).toBeUndefined()
    expect(rules.providers.find(provider => provider.provider === 'qwen')).toBeUndefined()
  })

  it('prices the DeepSeek account route from the official rules', () => {
    const saved = { revision: 7, rules: defaultBillingRules() } as unknown as BillingSnapshot
    const decision = billUsage(saved, { inputTokens: 1_000_000, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 },
      'deepseek-account', 'deepseek-v4-pro', Date.parse('2026-09-14T10:00:00+08:00'))
    expect(decision.billingStatus).toBe('priced')
    expect(decision.cost).toBeGreaterThan(0)
    expect(decision.billingRule?.model).toBe('deepseek-v4-pro')
  })
})

/** 合成价格夹具：与时间、节假日、倍率无关，金额按定义手算，不复用被测函数。 */
const SYNTHETIC = { input: 2, cacheHit: 0.5, cacheWrite: 2, output: 8 }
const SYNTHETIC_USAGE = { inputTokens: 1_000_000, cacheReadTokens: 200_000, cacheWriteTokens: 100_000, outputTokens: 300_000 }
function officialWith(rule: Partial<{ enabled: boolean; modelEnabled: boolean; multiplier: number }> = {}) {
  const model = { model: 'deepseek-v4-pro', enabled: rule.modelEnabled ?? true, multiplier: rule.multiplier ?? 1, mode: 'fixed' as const,
    fixed: { ...SYNTHETIC }, peak: { ...SYNTHETIC }, offPeak: { ...SYNTHETIC }, periods: [] }
  return { revision: 7, rules: { version: 1, providers: [{ provider: 'deepseek-official', enabled: rule.enabled ?? true, models: [model] }] } } as unknown as BillingSnapshot
}

describe('billing rule resolution', () => {
  it('T1: prices the account route through the inherited official rule at the independently computed amount', () => {
    const saved = officialWith()
    expect(resolveBillingProvider(saved.rules, 'deepseek-account')).toMatchObject({ source: 'official-family' })
    const decision = billUsage(saved, SYNTHETIC_USAGE, 'deepseek-account', 'deepseek-v4-pro', Date.parse('2026-09-14T10:00:00+08:00'))
    expect(decision.billingStatus).toBe('priced')
    expect(decision).toMatchObject({ costInput: 2, costCacheRead: 0.1, costCacheWrite: 0.2, costOutput: 2.4 })
    expect(decision.cost).toBeCloseTo(4.7, 10)
  })

  it('T2: keeps provider-disabled when the inherited official provider is switched off', () => {
    const decision = billUsage(officialWith({ enabled: false }), SYNTHETIC_USAGE, 'deepseek-account', 'deepseek-v4-pro', Date.now())
    expect(decision).toMatchObject({ billingStatus: 'disabled', billingReason: 'provider-disabled', cost: 0 })
  })

  it('T3: keeps model-disabled when the inherited model is switched off', () => {
    const decision = billUsage(officialWith({ modelEnabled: false }), SYNTHETIC_USAGE, 'deepseek-account', 'deepseek-v4-pro', Date.now())
    expect(decision).toMatchObject({ billingStatus: 'disabled', billingReason: 'model-disabled', cost: 0 })
  })

  it('T4: gives an explicit account entry precedence over the official rules', () => {
    const saved = officialWith()
    const account = { model: 'deepseek-v4-pro', enabled: true, multiplier: 1, mode: 'fixed' as const, fixed: { input: 10, cacheHit: 10, cacheWrite: 10, output: 10 }, peak: { input: 10, cacheHit: 10, output: 10 }, offPeak: { input: 10, cacheHit: 10, output: 10 }, periods: [] }
    saved.rules.providers.push({ provider: 'deepseek-account', enabled: true, models: [account] })
    expect(resolveBillingProvider(saved.rules, 'deepseek-account')).toMatchObject({ source: 'explicit' })
    const decision = billUsage(saved, SYNTHETIC_USAGE, 'deepseek-account', 'deepseek-v4-pro', Date.now())
    // 显式账号价 10 元/百万，绝不能用官方同名的 2 元价。
    expect(decision.cost).toBeCloseTo(1 * 10 + 0.2 * 10 + 0.1 * 10 + 0.3 * 10, 10)
  })

  it('T5: keeps an explicit account entry from falling back per model to the official prices', () => {
    const saved = officialWith()
    const officialModels = saved.rules.providers[0]!.models
    // 官方共享条目确实带有该模型；显式账号条目存在但故意缺它，只留一个官方没有的兄弟模型。
    expect(officialModels.some(model => model.model === 'deepseek-v4-pro')).toBe(true)
    const sibling = { ...officialModels[0]!, model: 'deepseek-v4-sibling' }
    saved.rules.providers.push({ provider: 'deepseek-account', enabled: true, models: [sibling] })
    expect(resolveBillingProvider(saved.rules, 'deepseek-account')).toMatchObject({ source: 'explicit' })
    expect(resolveBillingProvider(saved.rules, 'deepseek-account').owner?.provider).toBe('deepseek-account')
    const decision = billUsage(saved, SYNTHETIC_USAGE, 'deepseek-account', 'deepseek-v4-pro', Date.now())
    // 账号缺该模型时保持缺规则：绝不逐模型借用官方同名的 2 元/百万价。
    expect(decision).toMatchObject({ billingStatus: 'unpriced', billingReason: 'rule-missing', cost: 0, modelMultiplier: 1 })
    expect(decision.billingRule).toBeUndefined()
  })

  it('T6: leaves a model missing from the inherited owner unpriced instead of guessing a price', () => {
    const saved = officialWith()
    const account = billUsage(saved, SYNTHETIC_USAGE, 'deepseek-account', 'deepseek-v4-unknown', Date.now())
    expect(account).toMatchObject({ billingStatus: 'unpriced', billingReason: 'rule-missing', cost: 0 })
  })

  it('T7: never inherits official prices by name alone', () => {
    const saved = officialWith()
    expect(resolveBillingProvider(saved.rules, 'deepseek-account-eu')).toMatchObject({ source: 'none' })
    const decision = billUsage(saved, SYNTHETIC_USAGE, 'deepseek-account-eu', 'deepseek-v4-pro', Date.now())
    expect(decision).toMatchObject({ billingStatus: 'unpriced', billingReason: 'rule-missing', cost: 0 })
  })
})
