/**
 * Wire contract for provider plan-quota snapshots.
 *
 * Plan quotas describe a provider's subscription allowance (for example a
 * five-hour rolling window and a weekly allowance) instead of a prepaid
 * balance. The Host queries each provider's own quota endpoint and publishes
 * the normalized result here; the Client only renders it.
 * @module @deepseek-ai/dsh-token-monitor-contract
 */

/** Refresh cycle of one plan quota window. */
export type PlanQuotaWindowKind = '5h' | 'week' | 'month' | 'other'

/** One rolling allowance window of a provider plan. */
export interface PlanQuotaWindow {
  /** Refresh cycle of this window. */
  kind: PlanQuotaWindowKind
  /** Display label, for example `5 小时` or `每周`. */
  label: string
  /** Used share of the allowance in percent (0..100); null when the provider reports no ratio. */
  usedPercent: number | null
  /** Absolute amount already used; null when the provider reports no absolute amount. */
  used: number | null
  /** Absolute allowance; null when the provider reports no absolute amount. */
  total: number | null
  /** Epoch milliseconds of the next refresh; absent when the provider reports none. */
  resetAt?: number
}

/** Plan quota state of one configured provider. */
export interface PlanQuotaProvider {
  /** Configured provider identifier. */
  provider: string
  /** Human readable provider name, for example `GLM Coding Plan`. */
  label: string
  /** Subscription level reported by the provider, for example `pro`. */
  plan?: string
  /** Allowance windows of this provider; empty when the provider reports none. */
  windows: PlanQuotaWindow[]
  /** Epoch milliseconds when this snapshot was produced. */
  updatedAt: number
  /** `ok` when the provider answered, `error` when the query failed. */
  status: 'ok' | 'error'
}

/** Aggregated plan quota snapshot for every provider that exposes plan quotas. */
export interface PlanQuotaSnapshot {
  /** Epoch milliseconds when this snapshot was produced. */
  updatedAt: number
  /** Per-provider entries, ordered by provider identifier. */
  providers: PlanQuotaProvider[]
}
