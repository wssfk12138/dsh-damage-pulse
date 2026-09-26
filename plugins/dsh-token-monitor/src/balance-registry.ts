/** Provider-specific balance requests with credential rotation and stale-result rejection. */
import { randomUUID } from 'node:crypto'
import type { BalanceScriptSnapshot } from './balance-config.ts'
import { evaluateBalanceScript, validateScriptBalance, type BalanceRequest } from './balance-script.ts'
import type { BalanceInfo } from './types.ts'

export interface BalanceIdentity { apiKey: string; baseURL: string }
export interface ProviderBalance extends BalanceInfo { provider: string; scriptRevision: number; credentialGeneration: string }
interface Entry { identity: BalanceIdentity; revision: number; generation: string; controller: AbortController; pending?: Promise<ProviderBalance | undefined>; value?: ProviderBalance; nextAttempt: number; failures: number }
interface Dependencies {
  readScript(provider: string): Promise<BalanceScriptSnapshot>
  resolveIdentity(provider: string): Promise<BalanceIdentity | undefined>
  request(descriptor: BalanceRequest, baseURL: string, apiKey: string, signal: AbortSignal): Promise<unknown>
  now?: () => number
}

/** Demand-driven cache: one request per provider, no polling of unused providers. */
export class BalanceRegistry {
  private entries = new Map<string, Entry>()
  private stopped = false
  private active = 0
  private inspections = new Map<string, Promise<void>>()
  private generations = new Map<string, number>()
  private pendingRequests = new Set<Promise<ProviderBalance | undefined>>()
  constructor(private dependencies: Dependencies) {}

  /** Read current credentials before serving cached data; never return an older generation.
   * @param provider Exact configured provider identifier.
   * @returns Current balance, or undefined while unconfigured, unavailable or throttled.
   */
  async get(provider: string): Promise<ProviderBalance | undefined> {
    if (this.stopped) return undefined
    const preceding = this.inspections.get(provider)
    let release!: () => void
    const lock = new Promise<void>(resolve => { release = resolve })
    this.inspections.set(provider, lock)
    await preceding
    try {
      // Serialize identity reads, but release the lock before awaiting network I/O.
      return (await this.prepare(provider)).result
    } finally {
      release()
      if (this.inspections.get(provider) === lock) this.inspections.delete(provider)
    }
  }

  private async prepare(provider: string): Promise<{ result?: ProviderBalance | Promise<ProviderBalance | undefined> }> {
    if (this.stopped) return {}
    const generation = this.generations.get(provider) ?? 0
    const [script, identity] = await Promise.all([this.dependencies.readScript(provider), this.dependencies.resolveIdentity(provider)])
    if (this.stopped || generation !== (this.generations.get(provider) ?? 0)) return {}
    if (script.status !== 'valid' || !script.request || !identity) { this.invalidate(provider); return {} }
    let entry = this.entries.get(provider)
    if (!entry || entry.revision !== script.revision || entry.identity.apiKey !== identity.apiKey || entry.identity.baseURL !== identity.baseURL) {
      this.invalidate(provider)
      entry = { identity, revision: script.revision, generation: randomUUID(), controller: new AbortController(), nextAttempt: 0, failures: 0 }
      this.entries.set(provider, entry)
    }
    if (entry.pending) return { result: entry.pending }
    const now = this.dependencies.now ?? Date.now
    if (now() < entry.nextAttempt || this.active >= 4) return entry.value ? { result: entry.value } : {}
    const current = entry
    this.active++
    current.pending = (async () => {
      try {
        const raw = await this.dependencies.request(script.request!, identity.baseURL, identity.apiKey, current.controller.signal)
        const balance = validateScriptBalance(await evaluateBalanceScript(script.script, raw))
        const [latestScript, latestIdentity] = await Promise.all([this.dependencies.readScript(provider), this.dependencies.resolveIdentity(provider)])
        if (this.stopped || current.controller.signal.aborted || this.entries.get(provider) !== current) return undefined
        if (latestScript.revision !== current.revision || latestScript.status !== 'valid'
          || latestIdentity?.apiKey !== identity.apiKey || latestIdentity.baseURL !== identity.baseURL) { this.invalidate(provider); return undefined }
        current.value = { ...balance, updatedAt: now(), provider, scriptRevision: script.revision, credentialGeneration: current.generation }
        current.failures = 0
        current.nextAttempt = now() + 15_000
        return current.value
      } catch {
        // No upstream exception or response content is exposed to logs or clients.
        delete current.value
        current.failures++
        current.nextAttempt = now() + Math.min(300_000, 15_000 * 2 ** Math.min(current.failures, 5))
        return undefined
      } finally { this.active--; delete current.pending }
    })()
    const pending = current.pending
    this.pendingRequests.add(pending)
    void pending.finally(() => this.pendingRequests.delete(pending))
    return { result: pending }
  }

  /** Cancel a provider's obsolete request and drop its cached balance.
   * @param provider Exact provider identifier.
   */
  invalidate(provider: string): void {
    this.generations.set(provider, (this.generations.get(provider) ?? 0) + 1)
    this.entries.get(provider)?.controller.abort()
    this.entries.delete(provider)
  }

  /** Cancel all work when the owning plugin context is disposed. */
  async stop(): Promise<void> {
    this.stopped = true
    for (const provider of this.entries.keys()) this.invalidate(provider)
    await Promise.allSettled([...this.inspections.values(), ...this.pendingRequests])
  }
}
