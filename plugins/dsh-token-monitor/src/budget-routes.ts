import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { dailyBudgetInfo } from './budget.ts'
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
  table: PricingTable | (() => PricingTable),
): void {
  // 价格表可传活引用：路由按请求读取，避免装配顺序决定用哪张表。
  const readPriceTable = typeof table === 'function' ? table : () => table
  ctx.webServer.register({
    kind: 'exact',
    path: '/api/token-monitor/daily-budget',
    handler: (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
      res.end(JSON.stringify(dailyBudgetInfo(storage.todaySpend(), getBudget())))
    },
  })

  ctx.webServer.register({
    kind: 'exact',
    path: '/api/token-monitor/pricing-eligibility',
    handler: (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
      res.end(JSON.stringify(pricingEligibilityInfo(readPriceTable())))
    },
  })
}
