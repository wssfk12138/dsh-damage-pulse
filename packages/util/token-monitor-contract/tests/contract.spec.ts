import { describe, expect, it } from 'vitest'
import {
  DEFAULT_TOKEN_MONITOR_SETTINGS,
  TOKEN_MONITOR_SETTINGS_SCHEMA_VERSION,
  UnsupportedTokenMonitorSettingsVersionError,
  parseTokenMonitorSettingsPatchRequest,
  parseTokenMonitorSettingsSnapshot,
  pickPublicTokenMonitorSettings,
  planTokenMonitorSettingsMigration,
  validateBillingRules,
  validateBillingApplied,
  emptyBillingRule,
} from '../src/index.ts'

describe('token monitor settings contract', () => {
  it.each([undefined, 'input', 0, null, 12])('retains cache-write price %s in base and all tier lists', (cacheWrite) => {
    const model = emptyBillingRule('m')
    const rate = { input: 2, cacheHit: 1, output: 3, ...(cacheWrite === undefined ? {} : { cacheWrite }) }
    Object.assign(model, { fixed: rate, peak: rate, offPeak: rate, ...Object.fromEntries(['tiers', 'peakTiers', 'offPeakTiers'].map(key => [key, [{ ...rate, maxInputTokens: null }]])) })
    const parsed = validateBillingRules({ version: 1, providers: [{ provider: 'v', enabled: true, models: [model] }] }).providers[0]!.models[0]!
    for (const key of ['fixed', 'peak', 'offPeak'] as const) expect(parsed[key]).toEqual(rate)
    for (const key of ['tiers', 'peakTiers', 'offPeakTiers'] as const) expect(parsed[key]![0]).toEqual({ ...rate, maxInputTokens: null })
    model.fixed.cacheWrite = -1
    expect(() => validateBillingRules({ version: 1, providers: [{ provider: 'v', enabled: true, models: [model] }] })).toThrow('Invalid unit price')
  })

  it('rejects fabricated source dates and unsafe links while retaining unverified metadata', () => {
    const model = emptyBillingRule('m')
    model.source = { templateId: 'v/m', version: '1', name: 'Example', verifiedAt: null, originalCurrency: 'CNY', originalUnit: 'million tokens', conversionBasis: 'none', modified: false }
    const parse = () => validateBillingRules({ version: 1, providers: [{ provider: 'v', enabled: true, models: [model] }] })
    expect(parse().providers[0]!.models[0]!.source).toEqual(model.source)
    model.source.verifiedAt = '2026-02-30'
    expect(parse).toThrow('Invalid source date')
    model.source.verifiedAt = '2026-09-16'
    model.source.url = 'javascript:alert(1)'
    expect(parse).toThrow('Invalid source URL')
    model.source.url = 'https://example.com/pricing'
    expect(parse().providers[0]!.models[0]!.source?.verifiedAt).toBe('2026-09-16')
  })

  it('requires resolved durable settlement prices and a stable rule identifier', () => {
    const applied = { ruleId: 'a'.repeat(64), mode: 'peak', tierMax: null, rate: { input: 2, cacheHit: 1, cacheWrite: 0, output: 3 } }
    expect(validateBillingApplied(applied)).toEqual(applied)
    for (const cacheWrite of ['input', undefined]) expect(() => validateBillingApplied({ ...applied, rate: { ...applied.rate, cacheWrite } })).toThrow()
    expect(() => validateBillingApplied({ ...applied, ruleId: 'revision-1' })).toThrow('Invalid rule identity')
    expect(() => validateBillingApplied({ ...applied, tierMax: 0 })).toThrow('Invalid settled tier')
  })

  it.each(['peakTiers', 'offPeakTiers'] as const)('copies and validates %s independently', (key) => {
    const model = emptyBillingRule('m')
    model[key] = [{ maxInputTokens: null, input: 2, cacheHit: null, output: 6 }]
    const input = { version: 1, providers: [{ provider: 'vendor', enabled: true, models: [model] }] }
    const copied = validateBillingRules(input).providers[0].models[0]
    model[key][0].output = 9
    expect(copied[key]![0].output).toBe(6)
    model[key] = []
    expect(validateBillingRules(input).providers[0].models[0][key]).toEqual([])
    model[key] = [{ maxInputTokens: 100, input: 2, cacheHit: null, output: 6 }]
    expect(() => validateBillingRules(input)).toThrow('Final price tier must be open ended')
    model[key].push({ maxInputTokens: 100, input: 2, cacheHit: null, output: 6 })
    expect(() => validateBillingRules(input)).toThrow('Invalid price tier boundary')
  })
  it('rejects multiple open-ended context tiers', () => {
    const model = emptyBillingRule('m')
    model.tiers = [
      { maxInputTokens: null, input: 1, cacheHit: 1, output: 1 },
      { maxInputTokens: null, input: 2, cacheHit: 2, output: 2 },
    ]
    expect(() => validateBillingRules({
      version: 1, providers: [{ provider: 'vendor', enabled: true, models: [model] }],
    })).toThrow('Invalid price tier boundary')
  })

  it('accepts the canonical snapshot and detaches public fields', () => {
    const snapshot = {
      schemaVersion: TOKEN_MONITOR_SETTINGS_SCHEMA_VERSION,
      revision: 3,
      settings: { ...DEFAULT_TOKEN_MONITOR_SETTINGS },
    }
    expect(parseTokenMonitorSettingsSnapshot(snapshot)).toEqual({ ok: true, value: snapshot })
    expect(pickPublicTokenMonitorSettings({ ...snapshot.settings, priceTable: { secret: true } }))
      .toEqual(snapshot.settings)
  })

  it('accepts partial patches with optimistic concurrency', () => {
    expect(parseTokenMonitorSettingsPatchRequest({
      expectedRevision: 7,
      patch: { displayMode: 'spend', showWhaleGirl: false, dailyBudgetCny: 88.88 },
    })).toEqual({
      ok: true,
      value: { expectedRevision: 7, patch: { displayMode: 'spend', showWhaleGirl: false, dailyBudgetCny: 88.88 } },
    })
  })

  it.each([
    [{ patch: { unknown: true } }, 'patch.unknown'],
    [{ patch: { dailyBudgetCny: 1.234 } }, 'patch.dailyBudgetCny'],
    [{ patch: { dailyBudgetCny: Number.POSITIVE_INFINITY } }, 'patch.dailyBudgetCny'],
    [{ patch: { displayMode: 'other' } }, 'patch.displayMode'],
    [{ expectedRevision: -1, patch: {} }, 'expectedRevision'],
    [JSON.parse('{"patch":{"__proto__":true}}'), 'patch.__proto__'],
  ])('rejects invalid or dangerous input at %s', (input, field) => {
    const result = parseTokenMonitorSettingsPatchRequest(input)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.fields).toHaveProperty(field)
  })

  it('plans legacy migration and refuses a newer schema', () => {
    const migrated = { schemaVersion: 3, budgetExceededNotificationEnabled: false, cacheHitAnomalyNotificationEnabled: false }
    expect(planTokenMonitorSettingsMigration({ dailyBudgetCny: 10 })).toEqual(migrated)
    expect(planTokenMonitorSettingsMigration({ schemaVersion: 1 })).toEqual(migrated)
    expect(planTokenMonitorSettingsMigration({ schemaVersion: 2 })).toEqual(migrated)
    expect(planTokenMonitorSettingsMigration({ schemaVersion: 3 })).toBeUndefined()
    expect(() => planTokenMonitorSettingsMigration({ schemaVersion: 4 }))
      .toThrow(UnsupportedTokenMonitorSettingsVersionError)
  })

  it('validates cache anomaly settings at their boundaries', () => {
    expect(
      parseTokenMonitorSettingsPatchRequest({
        patch: { cacheHitAnomalyThreshold: 0, cacheHitAnomalyConsecutiveCalls: 20 },
      }).ok,
    ).toBe(true)
    for (const value of [-1, 101, 30.5]) {
      expect(parseTokenMonitorSettingsPatchRequest({ patch: { cacheHitAnomalyThreshold: value } }).ok).toBe(false)
    }
    for (const value of [1, 21, 3.5]) {
      expect(parseTokenMonitorSettingsPatchRequest({ patch: { cacheHitAnomalyConsecutiveCalls: value } }).ok).toBe(false)
    }
  })

  it('validates context price tiers and keeps legacy rules compatible', () => {
    const base = {
      version: 1,
      providers: [{ provider: 'vendor', enabled: true, models: [{ model: 'm', enabled: true, multiplier: 1, mode: 'fixed', fixed: { input: 1, cacheHit: 1, output: 1 }, peak: { input: 1, cacheHit: 1, output: 1 }, offPeak: { input: 1, cacheHit: 1, output: 1 }, periods: [] }] }],
    }
    expect(validateBillingRules(base).providers[0].models[0].tiers).toBeUndefined()
    const valid = validateBillingRules({ ...base, providers: [{ ...base.providers[0], models: [{
      ...base.providers[0].models[0], tiers: [
        { maxInputTokens: 32_000, input: 1, cacheHit: 1, output: 1 },
        { maxInputTokens: null, input: 2, cacheHit: 2, output: 2 },
      ],
    }] }] })
    expect(valid.providers[0].models[0].tiers).toHaveLength(2)
    expect(() => validateBillingRules({ ...base, providers: [{ ...base.providers[0], models: [{ ...base.providers[0].models[0], tiers: [{ maxInputTokens: null, input: 1, cacheHit: 1, output: 1 }, { maxInputTokens: 32_000, input: 2, cacheHit: 2, output: 2 }] }] }] })).toThrow('Invalid price tier boundary')
    expect(() => validateBillingRules({ ...base, providers: [{ ...base.providers[0], models: [{ ...base.providers[0].models[0], tiers: [{ maxInputTokens: 32_000, input: 1, cacheHit: 1, output: 1 }] }] }] })).toThrow('Final price tier must be open ended')
  })
})
