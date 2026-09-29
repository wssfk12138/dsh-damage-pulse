/** Provider-owned script persistence, endpoint approval and independent revisions. */
import { evaluateBalanceScript, OFFICIAL_BALANCE_SCRIPT, validateBalanceRequest, type BalanceRequest } from './balance-script.ts'
import type { BuiltInBalanceAdapter } from './balance-adapters.ts'
import { endpointKey, validateBalanceEndpoint, validateBalanceScripts, BalanceScriptConflictError, MAX_BALANCE_ENDPOINTS, type BalanceEndpoint, type BalanceScriptEntry } from './balance-storage.ts'
import { OFFICIAL_PROVIDER_ID, isOfficialProvider } from './pricing.ts'
import { refuseScriptLiteral, type RefusedScriptLiteral } from './script-literals.ts'
import { PluginStoreConflictError, type TokenMonitorStore } from './plugin-store.ts'

/** Saved script state; an unapproved endpoint pauses querying until the owner approves it. */
export interface BalanceScriptSnapshot extends BalanceScriptEntry {
  provider: string
  status: 'unconfigured' | 'valid' | 'invalid' | 'unapproved'
  error?: string
  request?: BalanceRequest
  /** Present when the source is a Host-shipped adapter instead of saved text. */
  source?: 'built-in'
  /** Vendor label of that adapter. */
  adapter?: string
}

/** Endpoints the built-in official adapter may use without an explicit approval. */
export const OFFICIAL_BALANCE_ENDPOINTS: readonly BalanceEndpoint[] = Object.freeze([{ path: '/user/balance', method: 'GET' } as const])

const SENSITIVE_SCRIPT_ERROR = 'Balance scripts stay keyless: only a request path, GET/POST, an auth kind, response field names and a JSON body may appear'
const UNAPPROVED_SCRIPT_ERROR = 'Endpoint not approved: querying stays paused until this exact path and method are approved'

/** A script carries material that must never enter settings or a model context. */
export class SensitiveBalanceScriptError extends Error {
  constructor() { super(SENSITIVE_SCRIPT_ERROR) }
}

/** Approval may only name the endpoint the saved adapter actually declares. */
export class BalanceEndpointMismatchError extends Error {
  constructor() { super('Balance endpoint approval must match the saved adapter request') }
}

/** Describe a refused literal without echoing its value. */
function refusedError(refused: RefusedScriptLiteral): string {
  if (refused.reason === 'comment') return 'Balance script comments contain a ' + String(refused.length) + '-character token-like run; keep credentials out of comments'
  if (refused.reason === 'template') return 'Balance script literal ' + String(refused.index) + ' uses template substitution; adapters must be plain keyless source'
  if (refused.reason === 'escape') return 'Balance script literal ' + String(refused.index) + ' uses an escape sequence; adapters must be plain keyless source'
  return 'Balance script literal ' + String(refused.index) + ' (' + String(refused.length) + ' characters) is outside the allowed vocabulary; an adapter may only name a request path, GET/POST, an auth kind, response field names and a JSON body'
}

/** Refuse source that could carry a pasted credential, endpoint or generated code. */
export function assertKeylessBalanceScript(script: string): void {
  if (refuseScriptLiteral(script) !== undefined) throw new SensitiveBalanceScriptError()
}

/** Saved script edits do not require a separate activation operation. */
export class BalanceScriptConfig {
  private validations = new Map<string, { key: string; script: string; value: Promise<BalanceScriptSnapshot> }>()
  constructor(
    private store: TokenMonitorStore,
    /** Resolve a Host-shipped adapter for providers that never saved a script. */
    private resolveAdapter: (provider: string) => Promise<BuiltInBalanceAdapter | undefined> = async () => undefined,
  ) {}

  /** Read the provider's saved text and validation state, without querying its API.
   * @param provider Exact configured provider id.
   * @returns Keyless state of the currently saved script.
   */
  async read(provider: string): Promise<BalanceScriptSnapshot> {
    const saved = this.store.get().balanceScripts?.[provider]
    // A saved script is the owner's explicit choice and always wins; only a
    // provider that never saved one can fall back to a Host-shipped adapter.
    const adapter = saved === undefined ? await this.resolveAdapter(provider) : undefined
    const entry = saved ?? { revision: 0, script: adapter?.script ?? (isOfficialProvider(provider) ? OFFICIAL_BALANCE_SCRIPT : '') }
    const key = adapter === undefined ? 'saved' : 'built-in'
    const cached = this.validations.get(provider)
    if (cached?.key === key && cached.script === entry.script) {
      return { ...(await cached.value), revision: entry.revision }
    }
    const value = (async (): Promise<BalanceScriptSnapshot> => {
      if (!entry.script.trim()) return { provider, ...entry, status: 'unconfigured' }
      const refused = refuseScriptLiteral(entry.script)
      // Refused source is hidden rather than returned, so a pasted secret cannot
      // ride an editor response or a model tool result.
      if (refused !== undefined) return { provider, revision: entry.revision, script: '', status: 'invalid', error: refusedError(refused) }
      try {
        const request = validateBalanceRequest(await evaluateBalanceScript(entry.script))
        if (!this.approvedEndpoints(provider, adapter).some(endpoint => endpointKey(endpoint) === endpointKey(request))) {
          return { provider, ...entry, status: 'unapproved', request, error: UNAPPROVED_SCRIPT_ERROR }
        }
        return {
          provider, ...entry, status: 'valid', request,
          ...(adapter === undefined ? {} : { source: 'built-in' as const, adapter: adapter.label }),
        }
      } catch (error) {
        return { provider, ...entry, status: 'invalid', error: error instanceof Error ? error.message : 'Invalid balance script' }
      }
    })()
    this.validations.set(provider, { key, script: entry.script, value })
    return value
  }

  /** Approve the endpoint the saved adapter declares, leaving every other target refused.
   * @param provider Exact configured provider id.
   * @param endpoint Candidate taken from the saved adapter's request.
   * @returns Saved and automatically revalidated state.
   */
  async approve(provider: string, endpoint: unknown): Promise<BalanceScriptSnapshot> {
    const target = validateBalanceEndpoint(endpoint)
    const snapshot = await this.read(provider)
    if (snapshot.status !== 'unapproved' || snapshot.request === undefined
      || endpointKey(snapshot.request) !== endpointKey(target)) throw new BalanceEndpointMismatchError()
    for (let attempt = 0; attempt < 4; attempt++) {
      const state = this.store.get()
      const current = state.balanceEndpoints?.[provider] ?? []
      const next = [target, ...current.filter(item => endpointKey(item) !== endpointKey(target))].slice(0, MAX_BALANCE_ENDPOINTS)
      try {
        await this.store.update({ balanceEndpoints: { [provider]: next } }, state.revision)
        // The endpoint policy is part of the cached verdict, so it must be re-read.
        this.validations.delete(provider)
        return await this.read(provider)
      } catch (error) {
        if (error instanceof PluginStoreConflictError && attempt < 3) continue
        throw error
      }
    }
    throw new BalanceScriptConflictError()
  }

  /** Save a whole script using its provider-local revision; invalid text is retained.
   * @param provider Exact configured provider id.
   * @param script Complete keyless source; empty clears the configuration.
   * @param expectedRevision Last observed provider-local revision.
   * @returns Saved and automatically validated state.
   */
  async update(provider: string, script: string, expectedRevision: number): Promise<BalanceScriptSnapshot> {
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw new TypeError('Invalid balance revision')
    assertKeylessBalanceScript(script)
    const next = { revision: expectedRevision + 1, script }
    validateBalanceScripts({ [provider]: next })
    for (let attempt = 0; attempt < 4; attempt++) {
      const state = this.store.get()
      const current = state.balanceScripts?.[provider]
      if ((current?.revision ?? 0) !== expectedRevision) throw new BalanceScriptConflictError()
      if (current?.script === script) return this.read(provider)
      try {
        await this.store.update({ balanceScripts: { [provider]: next } }, state.revision)
        return this.read(provider)
      } catch (error) {
        if (error instanceof PluginStoreConflictError && attempt < 3) continue
        throw error
      }
    }
    throw new BalanceScriptConflictError()
  }

  /** Approved endpoints for one provider; shipped adapters and the official seed are approved by construction. */
  private approvedEndpoints(provider: string, adapter?: BuiltInBalanceAdapter): readonly BalanceEndpoint[] {
    const stored = this.store.get().balanceEndpoints?.[provider]
    if (stored !== undefined) return stored
    const shipped = adapter === undefined ? [] : [adapter.endpoint]
    return isOfficialProvider(provider) ? [...OFFICIAL_BALANCE_ENDPOINTS, ...shipped] : shipped
  }
}
