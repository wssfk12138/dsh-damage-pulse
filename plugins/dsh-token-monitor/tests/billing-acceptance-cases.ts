import assert from 'node:assert/strict'
import { emptyBillingRule, validateBillingRules, resolveBillingProvider, OFFICIAL_PROVIDER_IDS, type BillingSnapshot, type BillingModelRule } from '@deepseek-ai/dsh-token-monitor-contract'
import { billUsage, defaultBillingRules } from '../src/billing.ts'
import { summarizeUsage } from '../src/usage-summary.ts'

const usage = { inputTokens: 100_000, cacheReadTokens: 200_000, cacheWriteTokens: 50_000, outputTokens: 70_000, reasoningTokens: 30_000 }
const holiday = Date.parse('2026-10-02T12:00:00+08:00')
const fixedRule = (): BillingModelRule => ({ ...emptyBillingRule('deepseek-v4-flash'), fixed: { input: 2, cacheHit: 1, cacheWrite: 2, output: 4 } })
const custom = (provider = 'vendor'): BillingSnapshot => ({ revision: 7, rules: { version: 1, providers: [{ provider, enabled: true, models: [fixedRule()] }] } })
const official = (): BillingSnapshot => ({ revision: 7, rules: defaultBillingRules() })
type ExpectedApplied = { mode: 'fixed' | 'peak' | 'offPeak'; rate: { input: number; cacheHit: number; cacheWrite: number; output: number | null }; multiplier: number }
const fixedApplied: ExpectedApplied = { mode: 'fixed', rate: { input: 2, cacheHit: 1, cacheWrite: 2, output: 4 }, multiplier: 1 }
const officialApplied = (model: string, peak: boolean): ExpectedApplied => ({ mode: peak ? 'peak' : 'offPeak', multiplier: 1,
  rate: model === 'deepseek-v4-pro'
    ? peak ? { input: 9, cacheHit: 0.3, cacheWrite: 9, output: 27 } : { input: 4.5, cacheHit: 0.15, cacheWrite: 4.5, output: 13.5 }
    : peak ? { input: 2, cacheHit: 0.04, cacheWrite: 2, output: 8 } : { input: 1, cacheHit: 0.02, cacheWrite: 1, output: 4 },
})

/** Compare source prices and root-package rule selection with independent integer micro-CNY amounts.
 * @returns Results for every fixed input, suitable for comparison by independent consumers.
 */
export function runBillingAcceptance() {
  const rows: Array<{ name: string; provider: string; model: string; timestamp: number; owner: string | null; status: string; reason: string | null; micro: number[]; peak: boolean; ruleId: string | null; totalTokens: number }> = []
  function check(name: string, snapshot: BillingSnapshot, provider: string, model: string, timestamp: number, owner: string | null, status: string, expected: number[], peak = false, reason: string | null = null, applied: ExpectedApplied = fixedApplied) {
    // Expected amounts are authored constants, never derived from either implementation.
    snapshot.rules = validateBillingRules(JSON.parse(JSON.stringify(snapshot.rules)))
    const before = JSON.stringify(snapshot)
    const selected = resolveBillingProvider(snapshot.rules, provider)
    assert.equal(selected.owner?.provider ?? null, owner, name + ': owner')
    const result = billUsage(snapshot, usage, provider, model, timestamp)
    assert.equal(result.billingStatus, status, name + ': status')
    assert.equal(result.billingReason ?? null, reason, name + ': reason')
    assert.equal(result.peak, peak, name + ': period')
    assert.equal(result.billingRuleVersion, 7, name + ': revision')
    const hasRule = reason !== 'rule-missing'
    assert.equal(result.modelMultiplier, hasRule ? applied.multiplier : 1, name + ': multiplier')
    if (hasRule) {
      assert.ok(result.billingRule, name + ': rule snapshot')
      assert.equal(result.billingRule.model, model, name + ': snapshot model')
      assert.equal(result.billingRule.mode, applied.mode === 'fixed' ? 'fixed' : 'peak', name + ': snapshot mode')
      assert.equal(result.billingRule.multiplier, applied.multiplier, name + ': snapshot multiplier')
      assert.deepEqual(result.billingRule, selected.owner!.models.find(rule => rule.model === model), name + ': snapshot contents')
      assert.notEqual(result.billingRule, selected.owner!.models.find(rule => rule.model === model), name + ': snapshot isolation')
    } else assert.equal(result.billingRule, undefined, name + ': no rule snapshot')
    if (status === 'disabled' || !hasRule) assert.equal(result.billingApplied, undefined, name + ': no applied rule')
    else {
      assert.ok(result.billingApplied, name + ': applied rule')
      assert.equal(result.billingApplied.mode, applied.mode, name + ': applied mode')
      assert.deepEqual(result.billingApplied.rate, applied.rate, name + ': independently expected rates')
      assert.equal(result.billingApplied.tierMax, undefined, name + ': no tier')
      assert.match(result.billingApplied.ruleId, /^[a-f0-9]{64}$/, name + ': rule id format only')
    }
    const costs = [result.costInput, result.costCacheRead, result.costCacheWrite, result.costOutput, result.costCache, result.cost]
    costs.forEach((cost, index) => assert.ok(Math.abs(cost * 1_000_000 - expected[index]!) < 0.000001, name + ': component ' + index))
    assert.equal(JSON.stringify(snapshot), before, name + ': no mutation')
    const summary = summarizeUsage([{ sessionId: 'synthetic-billing-matrix', turn: 1, step: 1, timestamp, provider, model, ...usage, ...result }], 'all', timestamp)
    assert.equal(summary?.totalTokens, 420_000, name + ': source aggregation excludes reasoning')
    rows.push({ name, provider, model, timestamp, owner, status, reason, micro: costs.map(cost => Math.round(cost * 1_000_000)), peak, ruleId: result.billingApplied?.ruleId ?? null, totalTokens: summary!.totalTokens })
  }
  const f1 = [200_000, 200_000, 100_000, 280_000, 300_000, 780_000]
  const zero = [0, 0, 0, 0, 0, 0]
  check('B01 custom exact F1', custom(), 'vendor', 'deepseek-v4-flash', holiday, 'vendor', 'priced', f1)
  for (const provider of ['vendor', 'deepseek-official', 'deepseek-account']) {
    const disabled = custom(provider)
    disabled.rules.providers[0]!.enabled = false
    if (provider === 'deepseek-account') disabled.rules.providers.push(...official().rules.providers)
    check('B02 explicit disabled ' + provider, disabled, provider, 'deepseek-v4-flash', holiday, provider, 'disabled', zero, false, 'provider-disabled')
    const empty = custom(provider)
    empty.rules.providers[0]!.models = []
    if (provider === 'deepseek-account') empty.rules.providers.push(...official().rules.providers)
    check('B03 empty exact ' + provider, empty, provider, 'deepseek-v4-flash', holiday, provider, 'unpriced', zero, false, 'rule-missing')
  }
  const modelDisabled = custom()
  modelDisabled.rules.providers[0]!.models[0]!.enabled = false
  check('B02 model disabled', modelDisabled, 'vendor', 'deepseek-v4-flash', holiday, 'vendor', 'disabled', zero, false, 'model-disabled')
  for (const model of ['unknown-model', 'deepseek-v4-flash-suffix']) check('B04 exact missing ' + model, custom(), 'vendor', model, holiday, 'vendor', 'unpriced', zero, false, 'rule-missing')
  const nullRate = custom()
  nullRate.rules.providers[0]!.models[0]!.fixed.output = null
  check('B04 null output rate', nullRate, 'vendor', 'deepseek-v4-flash', holiday, 'vendor', 'unpriced', zero, false, 'rate-missing', { ...fixedApplied, rate: { ...fixedApplied.rate, output: null } })
  assert.deepEqual([...OFFICIAL_PROVIDER_IDS], ['deepseek-official', 'deepseek-account'])
  const models = ['deepseek-flash', 'deepseek-v4-flash', 'deepseek-v4-flash-vision-exp', 'deepseek-v4-pro']
  assert.deepEqual(Object.keys(defaultBillingRules().providers[0]!.models.reduce<Record<string, true>>((all, rule) => ({ ...all, [rule.model]: true }), {})).sort(), [...models].sort())
  for (const provider of OFFICIAL_PROVIDER_IDS) for (const model of models) for (const peak of [false, true]) {
    const expected = model === 'deepseek-v4-pro'
      ? peak ? [900_000, 60_000, 450_000, 1_890_000, 510_000, 3_300_000] : [450_000, 30_000, 225_000, 945_000, 255_000, 1_650_000]
      : peak ? [200_000, 8_000, 100_000, 560_000, 108_000, 868_000] : [100_000, 4_000, 50_000, 280_000, 54_000, 434_000]
    check('B05 ' + provider + '/' + model + '/' + peak, official(), provider, model, peak ? Date.parse('2026-09-28T09:00:00+08:00') : holiday, 'deepseek-official', 'priced', expected, peak, null, officialApplied(model, peak))
  }
  for (const model of ['deepseek-v4-flash', 'unknown-model']) check('B06 unknown provider/' + model, official(), 'unknown-provider', model, holiday, null, 'unpriced', zero, false, 'rule-missing')
  const conflict = official()
  conflict.rules.providers.push(...custom('deepseek-account').rules.providers)
  check('B07 explicit account overrides official owner', conflict, 'deepseek-account', 'deepseek-v4-flash', holiday, 'deepseek-account', 'priced', f1)
  const multiplier = custom()
  multiplier.rules.providers[0]!.models[0]!.multiplier = 1.5
  check('B08 multiplier 1.5 reasoning already in output', multiplier, 'vendor', 'deepseek-v4-flash', holiday, 'vendor', 'priced', [300_000, 300_000, 150_000, 420_000, 450_000, 1_170_000], false, null, { ...fixedApplied, multiplier: 1.5 })
  const cacheWrite = custom()
  cacheWrite.rules.providers[0]!.models[0]!.fixed.cacheWrite = 5
  check('B08 independent cache write', cacheWrite, 'vendor', 'deepseek-v4-flash', holiday, 'vendor', 'priced', [200_000, 200_000, 250_000, 280_000, 450_000, 930_000], false, null, { ...fixedApplied, rate: { ...fixedApplied.rate, cacheWrite: 5 } })
  const times: Array<[string, boolean]> = [
    ['2026-09-28T08:59:59.999+08:00', false], ['2026-09-28T09:00:00+08:00', true],
    ['2026-09-28T11:59:59.999+08:00', true], ['2026-09-28T12:00:00+08:00', false],
    ['2026-09-28T13:59:59.999+08:00', false], ['2026-09-28T14:00:00+08:00', true],
    ['2026-09-28T17:59:59.999+08:00', true], ['2026-09-28T18:00:00+08:00', false],
    ['2026-09-27T09:00:00+08:00', false], ['2026-10-02T09:00:00+08:00', false],
  ]
  for (const [clock, peak] of times) check('B08 period ' + clock, official(), 'deepseek-account', 'deepseek-v4-flash', Date.parse(clock), 'deepseek-official', 'priced', peak ? [200_000, 8_000, 100_000, 560_000, 108_000, 868_000] : [100_000, 4_000, 50_000, 280_000, 54_000, 434_000], peak, null, officialApplied('deepseek-v4-flash', peak))
  assert.equal(rows.every(row => row.totalTokens === 420_000), true)
  return rows
}
