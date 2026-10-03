/** Balance network work and billing registrations share one disposable context. */
import type { Context } from '@deepseek-ai/cordis'
import type { ModuleServices } from '../module-services.ts'
import { BalanceScriptConfig } from '../balance-config.ts'
import { builtInBalanceAdapter } from '../balance-adapters.ts'
import { BalanceRegistry } from '../balance-registry.ts'
import { attachAccountBalance } from '../balance-account.ts'
import { resolveBalanceIdentity } from '../balance-provider.ts'
import { requestBalanceJson } from '../balance-network.ts'
import { registerBalanceApi, registerBalanceTools } from '../balance-api.ts'
import { registerBillingTools } from '../billing-tools.ts'
import { registerBudgetRoutes } from '../budget-routes.ts'
import { registerChargeEventsRoute } from '../charge-route.ts'
import { createRouteGuard } from '../http-trust.ts'
import { registerBillingSettingsRoutes, readBillingSnapshot } from '../settings.ts'
import { billUsage } from '../billing.ts'
import { priceUsage } from '../pricing.ts'
import { recordCharge, resetCharges } from '../charge.ts'
import { migrateBalanceEndpointPolicy } from '../balance-migration.ts'

export function apply(ctx: Context, services: ModuleServices): void {
  const billing: NonNullable<ModuleServices['billing']> = {
    readSnapshot: () => readBillingSnapshot(services.store, services.settings),
    priceRecord: (record, frozen) => {
      const { inputTokens, cacheReadTokens, cacheWriteTokens, outputTokens } = record
      const decision = frozen ? billUsage(frozen, { inputTokens, cacheReadTokens, cacheWriteTokens, outputTokens }, record.provider, record.model, record.timestamp) : undefined
      const cost = decision ?? priceUsage(record.inputTokens, record.cacheReadTokens, record.cacheWriteTokens, record.outputTokens, record.provider, record.model, record.timestamp, services.priceTable())
      return cost ? { ...record, ...cost, billingStatus: 'priced', ...decision } : record
    },
    onPersistedRecord: (record, kind) => {
      if (record.billingStatus !== 'priced') return
      recordCharge(record.cost, record.timestamp, kind, {
        cacheHit: { tokens: record.cacheReadTokens, cost: record.costCacheRead },
        cacheMiss: { tokens: record.inputTokens + record.cacheWriteTokens, cost: record.costInput + record.costCacheWrite },
        output: { tokens: record.outputTokens, cost: record.costOutput },
      }, { sessionId: record.sessionId, sourceEventSeq: record.sourceEventSeq!, provider: record.provider, model: record.model })
    },
  }
  ctx.effect(() => {
    services.billing = billing
    return () => { if (services.billing === billing) delete services.billing; resetCharges() }
  }, 'token-monitor: live billing provider')
  ctx.inject(['settings'], async settingsCtx => {
    await migrateBalanceEndpointPolicy(services.store)
    registerBillingTools(settingsCtx, services.store, services.settings)
    settingsCtx.inject(['webServer', 'connection'], web => registerBillingSettingsRoutes(web, services.store, services.settings))
    settingsCtx.inject(['llm'], balanceCtx => {
      const scripts = new BalanceScriptConfig(services.store, async provider => {
        if (provider === 'deepseek-account') return undefined
        const identity = await resolveBalanceIdentity(balanceCtx, provider, services.store.get().balanceProviders?.[provider])
        return identity === undefined ? undefined : builtInBalanceAdapter(identity.baseURL)
      })
      const registry = new BalanceRegistry({ readScript: provider => scripts.read(provider),
        resolveIdentity: provider => resolveBalanceIdentity(balanceCtx, provider, services.store.get().balanceProviders?.[provider]), request: requestBalanceJson })
      attachAccountBalance(balanceCtx, source => registry.setAccountSource(source))
      balanceCtx.effect(() => () => registry.stop(), 'token-monitor: balance requests')
      balanceCtx.inject(['webServer', 'connection'], web => registerBalanceApi(web, scripts, registry))
      balanceCtx.inject(['tools'], tools => registerBalanceTools(tools, scripts, registry))
    })
  })
  ctx.inject(['webServer', 'connection'], web => {
    const guard = createRouteGuard(web)
    web.effect(() => web.webServer.register({ kind: 'exact', path: '/api/token-monitor/today-spend', handler: (req, res) => {
      if (!guard(req, res)) return
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
      res.end(JSON.stringify(services.storage.todaySpend()))
    } }), 'token-monitor: today spend route')
    registerBudgetRoutes(web, services.storage, () => services.settings.user().dailyBudgetCny, services.priceTable())
    registerChargeEventsRoute(web)
  })
}
