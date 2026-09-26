/** Model tools for targeted, revision-checked changes to Host billing settings. */
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-llm'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { emptyBillingRule, validateBillingRules } from '@deepseek-ai/dsh-token-monitor-contract'
import { readBillingSnapshot } from './settings.ts'
import type { TokenMonitorStore } from './plugin-store.ts'
import type { TokenMonitorSettingsHandle } from './settings-handle.ts'
import { ModuleWork } from './module-work.ts'

const rate = { oneOf: [{ type: 'number' }, { type: 'null' }] } as const
const prices = { type: 'object', additionalProperties: false, properties: {
  input: { ...rate, description: 'Uncached input CNY per million tokens; null means unpriced.' },
  cacheHit: { ...rate, description: 'Cached input CNY per million tokens; null means unpriced.' },
  cacheWrite: { oneOf: [{ type: 'number' }, { type: 'null' }, { type: 'string', enum: ['input'] }], description: 'Cache write CNY per million tokens. input inherits uncached input; null is unpriced; 0 is free. Omission preserves the current choice.' },
  output: { ...rate, description: 'Output CNY per million tokens; null means unpriced.' },
} } as const
const tiers = { type: 'array', items: { type: 'object', additionalProperties: false, properties: {
  maxInputTokens: { oneOf: [{ type: 'integer' }, { type: 'null' }], required: true, description: 'Inclusive total-input ceiling; final tier must be null.' },
  input: { ...rate, required: true }, cacheHit: { ...rate, required: true }, output: { ...rate, required: true },
  cacheWrite: { oneOf: [{ type: 'number' }, { type: 'null' }, { type: 'string', enum: ['input'] }], description: 'Cache write rate; omitted or input inherits this tier input price.' },
} } } as const
const output = { schema: { type: 'json' } as const, render: (_args: unknown, value: JsonValue) => [{ type: 'text' as const, text: JSON.stringify(value) }] }

/** Register tools only while the real settings, LLM and tool services are available.
 * @param ctx Settings-owning plugin context.
 * @param store 插件自有状态，持有计费 revision。
 * @param handle 活用户配置视图。
 */
export function registerBillingTools(ctx: Context, store: TokenMonitorStore, handle: TokenMonitorSettingsHandle): void {
  ctx.inject(['tools', 'llm'], (toolCtx) => {
    const work = new ModuleWork()
    toolCtx.effect(() => () => work.stop(), 'token-monitor: billing tool operations')
    toolCtx.effect(() => toolCtx.tools.register(defineTool({
      name: 'token_monitor_billing_get',
      description: 'Read Host-global model billing rules and their revision. Only currently available models are listed. Use exact provider/model IDs from this result before updating prices. Rates are CNY per million tokens; no currency conversion. Does not change settings or historical costs.',
      parameters: { provider: { type: 'string', description: 'Optional exact provider ID.' }, model: { type: 'string', description: 'Optional exact model ID; provide provider too.' } },
      output,
      async execute(args, exec) {
        return work.run(async () => {
        exec.signal.throwIfAborted()
        if (args.model && !args.provider) throw new Error('Provide provider when selecting a model.')
        const groups = await Promise.all(toolCtx.llm.listProviders().filter(p => !args.provider || p.id === args.provider).map(async p => {
          try {
            const models = await toolCtx.llm.listModels(p.id)
            return { provider: p.id, name: p.name, models: models.filter(m => !args.model || m.id === args.model).map(m => ({ model: m.id, name: m.name })) }
          } catch { return { provider: p.id, name: p.name, models: [], error: 'Model catalog unavailable; retry before changing prices.' } }
        }))
        exec.signal.throwIfAborted()
        const snapshot = readBillingSnapshot(store, handle)
        return { revision: snapshot.revision, currency: 'CNY', priceUnit: 'per million tokens', timezone: 'Asia/Shanghai', groups: groups.map(group => {
          const provider = snapshot.rules.providers.find(p => p.provider === group.provider)
          return { ...group, enabled: provider?.enabled ?? false, models: group.models.map(model => ({ ...model, rule: provider?.models.find(m => m.model === model.model) ?? emptyBillingRule(model.model) })) }
        }) } as unknown as JsonValue
        })
      },
      presentCall: () => ({ card: 'generic', title: '读取模型计费规则', kind: 'read' }),
    })), 'token-monitor: read billing tool')
    toolCtx.effect(() => toolCtx.tools.register(defineTool({
      name: 'token_monitor_billing_update',
      description: 'Save only the requested fields for one available provider/model. Call token_monitor_billing_get first and supply its expectedRevision. Changes are Host-global and apply to requests started after this update; in-flight and historical costs keep their original rules. Preserve unspecified fields and other models. On revision conflict read again; never blindly retry. Prices are CNY per million tokens, multiplier must be positive. Change prices only when requested by the user; do not invent rates. providerEnabled affects every model under that provider.',
      parameters: {
        provider: { type: 'string', required: true }, model: { type: 'string', required: true }, expectedRevision: { type: 'integer', required: true },
        providerEnabled: { type: 'boolean', description: 'Explicit provider-wide billing switch; a newly created provider defaults to disabled.' },
        patch: { type: 'object', additionalProperties: false, required: true, properties: {
          enabled: { type: 'boolean' }, multiplier: { type: 'number' }, mode: { type: 'string', enum: ['fixed', 'peak'] },
          fixed: prices, peak: prices, offPeak: prices,
          periods: { type: 'array', description: 'Replace peak periods in Beijing time. Split cross-midnight periods. Sunday=0; start inclusive, end exclusive.', items: { type: 'object', additionalProperties: false, properties: { days: { type: 'array', items: { type: 'integer' }, required: true }, start: { type: 'integer', required: true, description: 'Minute of day, 0..1439.' }, end: { type: 'integer', required: true, description: 'Minute of day, 1..1440.' } } } },
          tiers, peakTiers: tiers, offPeakTiers: tiers,
        } },
      },
      output,
      async execute(args, exec) {
        return work.run(async () => {
        exec.signal.throwIfAborted()
        if (!Number.isSafeInteger(args.expectedRevision) || args.expectedRevision < 0) throw new Error('expectedRevision must be a non-negative safe integer.')
        if (!Object.keys(args.patch).length && args.providerEnabled === undefined) throw new Error('No billing changes supplied.')
        const models = await toolCtx.llm.listModels(args.provider)
        if (!models.some(model => model.id === args.model)) throw new Error('Model is not available for this provider. Read the model catalog again.')
        exec.signal.throwIfAborted()
        const snapshot = readBillingSnapshot(store, handle)
        if (snapshot.revision !== args.expectedRevision) throw new Error('Billing revision conflict. Read current rules and reapply only the user-requested changes.')
        let provider = snapshot.rules.providers.find(p => p.provider === args.provider)
        if (!provider) { provider = { provider: args.provider, enabled: false, models: [] }; snapshot.rules.providers.push(provider) }
        if (args.providerEnabled !== undefined) provider.enabled = args.providerEnabled
        const previous = provider.models.find(model => model.model === args.model) ?? emptyBillingRule(args.model)
        const next = { ...previous, ...args.patch, fixed: { ...previous.fixed, ...args.patch.fixed }, peak: { ...previous.peak, ...args.patch.peak }, offPeak: { ...previous.offPeak, ...args.patch.offPeak } }
        if (next.source) next.source = { ...next.source, modified: true }
        const index = provider.models.findIndex(model => model.model === args.model)
        if (index < 0) provider.models.push(next); else provider.models[index] = next
        const rules = validateBillingRules(snapshot.rules)
        await store.update({ billing: rules }, args.expectedRevision)
        const saved = readBillingSnapshot(store, handle)
        const savedProvider = saved.rules.providers.find(p => p.provider === args.provider)!
        return { revision: saved.revision, provider: args.provider, providerEnabled: savedProvider.enabled, rule: savedProvider.models.find(model => model.model === args.model)!, appliesTo: 'requests started after this update', historicalCostsChanged: false } as unknown as JsonValue
        })
      },
      presentCall: args => ({ card: 'generic', title: '修改模型计费规则', rawInput: { provider: args.provider, model: args.model, patch: args.patch } }),
      presentResult: (_args, result) => ({ card: 'generic', title: result.isError ? '计费规则未保存' : '计费规则已保存', content: result.content }),
    })), 'token-monitor: update billing tool')
  })
}
