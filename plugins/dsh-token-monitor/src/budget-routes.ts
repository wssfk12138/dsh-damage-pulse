import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { dailyBudgetInfo } from './budget.ts'
import { createRouteGuard } from './http-trust.ts'
import { OFFICIAL_PROVIDER_ID, type PricingTable } from './pricing.ts'
import type { UsageStorage } from './storage.ts'

export interface PricingEligibilityInfo {
  provider: typeof OFFICIAL_PROVIDER_ID
  models: string[]
  updatedAt: number
}

/** Publish only the current configured allowlist; the Client never embeds pricing model names. */
export function pricingEligibilityInfo(table: PricingTable, now = Date.now()): PricingEligibilityInfo {
  return {
    provider: OFFICIAL_PROVIDER_ID,
    models: Object.keys(table.models),
    updatedAt: now,
  }
}

/** Register additive M2 read endpoints without changing request admission or cancellation paths. */
export function registerBudgetRoutes(
  ctx: Context,
  storage: Pick<UsageStorage, 'todaySpend'>,
  getBudget: () => number,
  table: PricingTable,
): void {
  const guard = createRouteGuard(ctx)
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/api/token-monitor/daily-budget',
    handler: (req, res) => {
      if (!guard(req, res)) return
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
      res.end(JSON.stringify(dailyBudgetInfo(storage.todaySpend(), getBudget())))
    },
  }), 'token-monitor: daily budget route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/api/token-monitor/pricing-eligibility',
    handler: (req, res) => {
      if (!guard(req, res)) return
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
      res.end(JSON.stringify(pricingEligibilityInfo(table)))
    },
  }), 'token-monitor: pricing eligibility route')
}
