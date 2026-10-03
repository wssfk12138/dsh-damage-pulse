/** Narrow adapter for the desktop Host's account service; never reads login credentials. */
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import type { Context } from '@deepseek-ai/cordis'
import type { BalanceInfo } from './types.ts'
import type { ProviderBalance } from './balance-registry.ts'

interface AccountClient { version: string; locale: string; timezoneOffsetSeconds: number }
interface AccountService { getBalance(client: AccountClient): Promise<unknown> }

/** Use the installed Host package's version, not a hard-coded desktop release. */
export function accountClientMetadata(): AccountClient {
  let version = ''
  try {
    const manifest = createRequire(import.meta.url)('@deepseek-ai/dsh-deepseek-account/package.json') as { version?: unknown }
    if (typeof manifest.version === 'string') version = manifest.version
  } catch { /* Older Hosts may expose a service without exporting its manifest. */ }
  return { version, locale: Intl.DateTimeFormat().resolvedOptions().locale, timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60 }
}

/** Project ready wallets only; CNY takes precedence, and currencies are never added together. */
export function parseAccountBalance(raw: unknown): Omit<BalanceInfo, 'updatedAt'> | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const result = raw as Record<string, unknown>
  if (result.status !== 'ready' || !Array.isArray(result.value) || !Array.isArray(result.bonusWallets)) return undefined
  const totals = new Map<string, { toppedUpBalance: number; grantedBalance: number }>()
  for (const [rows, field] of [[result.value, 'toppedUpBalance'], [result.bonusWallets, 'grantedBalance']] as const) {
    for (const rawRow of rows) {
      if (!rawRow || typeof rawRow !== 'object') return undefined
      const row = rawRow as Record<string, unknown>
      if (!['CNY', 'USD'].includes(String(row.currency)) || typeof row.balance !== 'string'
        || !/^-?\d+(?:\.\d+)?$/.test(row.balance) || !Number.isFinite(Number(row.balance))) return undefined
      const currency = row.currency as string
      const total = totals.get(currency) ?? { toppedUpBalance: 0, grantedBalance: 0 }
      total[field] += Number(row.balance)
      totals.set(currency, total)
    }
  }
  const currency = totals.has('CNY') ? 'CNY' : 'USD'
  const total = totals.get(currency)
  if (!total) return undefined
  const totalBalance = Number((total.toppedUpBalance + total.grantedBalance).toFixed(8))
  if (!Number.isFinite(totalBalance)) return undefined
  return { currency, ...total, totalBalance, isAvailable: totalBalance > 0 }
}

/** Demand-driven native reads. No cache/backoff: every completed poll reaches the Host again. */
export class AccountBalanceSource {
  private generation = randomUUID()
  private stopped = false
  private pending: Promise<ProviderBalance | undefined> | undefined
  private requests = new Set<Promise<ProviderBalance | undefined>>()
  constructor(private read: () => Promise<unknown>, private now: () => number = Date.now) {}

  get(): Promise<ProviderBalance | undefined> {
    if (this.stopped) return Promise.resolve(undefined)
    if (this.pending) return this.pending
    const generation = this.generation
    const pending = Promise.resolve().then(() => this.stopped || generation !== this.generation ? undefined : this.read()).then(raw => {
      if (this.stopped || generation !== this.generation) return undefined
      const balance = parseAccountBalance(raw)
      return balance ? { ...balance, updatedAt: this.now(), provider: 'deepseek-account', scriptRevision: 0, credentialGeneration: generation } : undefined
    }).catch(() => undefined)
    this.pending = pending
    this.requests.add(pending)
    void pending.finally(() => {
      this.requests.delete(pending)
      if (this.pending === pending) this.pending = undefined
    })
    return pending
  }

  /** Host credential events rotate opaque comparison identity, without inspecting a token. */
  invalidate(): void { this.generation = randomUUID(); this.pending = undefined }
  async stop(): Promise<void> {
    this.stopped = true
    this.invalidate()
    await Promise.allSettled([...this.requests])
  }
}

/** Optional injection leaves API-key providers available on Hosts without account login. */
export function attachAccountBalance(ctx: Context, setSource: (source: AccountBalanceSource | undefined) => void): void {
  ctx.inject(['deepseekAccount'], accountCtx => {
    const client = accountClientMetadata()
    // Keep the optional service local: augmenting Context would replace the Host's full account API.
    const account = (accountCtx as unknown as { deepseekAccount: AccountService }).deepseekAccount
    const source = new AccountBalanceSource(() => account.getBalance(client))
    accountCtx.on('credentials/record-updated', () => source.invalidate())
    accountCtx.effect(() => {
      setSource(source)
      return async () => { setSource(undefined); await source.stop() }
    }, 'token-monitor: native account balance')
  })
}
