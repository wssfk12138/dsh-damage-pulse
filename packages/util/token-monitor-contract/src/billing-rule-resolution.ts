import type { BillingRules } from './billing.ts'

export const OFFICIAL_PROVIDER_ID = 'deepseek-official'
export const OFFICIAL_PROVIDER_IDS = [OFFICIAL_PROVIDER_ID, 'deepseek-account'] as const

/** Known official billing identities; never infer identity from a model name. */
export function isOfficialProvider(provider: string): boolean {
  return (OFFICIAL_PROVIDER_IDS as readonly string[]).includes(provider)
}

export type BillingRuleSource = 'explicit' | 'official-family' | 'none'
export interface ResolvedBillingProvider {
  owner: BillingRules['providers'][number] | undefined
  source: BillingRuleSource
}

/** An explicit provider owns its whole model list, even when empty or disabled. */
export function resolveBillingProvider(rules: BillingRules, providerId: string): ResolvedBillingProvider {
  const explicit = rules.providers.find(item => item.provider === providerId)
  if (explicit) return { owner: explicit, source: 'explicit' }
  if (!isOfficialProvider(providerId)) return { owner: undefined, source: 'none' }
  const official = rules.providers.find(item => item.provider === OFFICIAL_PROVIDER_ID)
  return official ? { owner: official, source: 'official-family' } : { owner: undefined, source: 'none' }
}
