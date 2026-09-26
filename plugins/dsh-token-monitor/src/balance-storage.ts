import { validateBalancePath } from './balance-path.ts'

/** Persisted provider script fields; validation does not execute scripts. */
export interface BalanceScriptEntry { revision: number; script: string }

/** Host-owned endpoint and credential reference for one provider's balance API. */
export interface BalanceProviderEntry { baseURL: string; apiKeyEnv: string }

/** One request target the owner approved for a provider's balance adapter. */
export interface BalanceEndpoint { path: string; method: 'GET' | 'POST' }

/** Upper bound on approved targets per provider; keeps the policy auditable by hand. */
export const MAX_BALANCE_ENDPOINTS = 8

/** Stable identity of one approved endpoint, used for de-duplication and comparison. */
export function endpointKey(endpoint: BalanceEndpoint): string {
  return endpoint.method + ' ' + endpoint.path
}

/** Validate one approved endpoint before it can authorize a credential-bearing request.
 * @param value Untrusted policy entry from settings or a route body.
 * @returns Canonical endpoint.
 */
export function validateBalanceEndpoint(value: unknown): BalanceEndpoint {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Invalid balance endpoint')
  const entry = value as BalanceEndpoint
  if (Object.keys(entry).some(key => !['path', 'method'].includes(key))) throw new TypeError('Invalid balance endpoint')
  if (entry.method !== 'GET' && entry.method !== 'POST') throw new TypeError('Balance endpoint must use GET or POST')
  return { path: validateBalancePath(entry.path), method: entry.method }
}

/** Validate the approved-endpoint policy before settings accept it.
 * @param value Untrusted persisted policy map.
 */
export function validateBalanceEndpoints(value: unknown): asserts value is Record<string, BalanceEndpoint[]> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Invalid balance endpoints')
  for (const [provider, raw] of Object.entries(value)) {
    if (!validProviderId(provider) || !Array.isArray(raw) || raw.length > MAX_BALANCE_ENDPOINTS) {
      throw new TypeError('Invalid balance endpoint provider')
    }
    for (const entry of raw) validateBalanceEndpoint(entry)
  }
}

function validProviderId(provider: string): boolean {
  return provider.trim() === provider && provider.length > 0 && provider.length <= 256
    && !['__proto__', 'constructor', 'prototype'].includes(provider)
}

/** Validate balance identities before they can authorize credential-bearing requests.
 * @param value Untrusted persisted section.
 */
export function validateBalanceProviders(value: unknown): asserts value is Record<string, BalanceProviderEntry> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Invalid balance providers')
  for (const [provider, raw] of Object.entries(value)) {
    if (!validProviderId(provider) || !raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new TypeError('Invalid balance provider')
    }
    const entry = raw as BalanceProviderEntry
    if (typeof entry.apiKeyEnv !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(entry.apiKeyEnv)
      || typeof entry.baseURL !== 'string' || Object.keys(entry).some(key => !['baseURL', 'apiKeyEnv'].includes(key))) {
      throw new TypeError('Invalid balance provider entry')
    }
    let url: URL
    try { url = new URL(entry.baseURL) } catch { throw new TypeError('Invalid balance provider URL') }
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash
      || (url.port !== '' && url.port !== '443') || url.hostname.endsWith('.')) {
      throw new TypeError('Balance provider URL must be an exact HTTPS endpoint')
    }
  }
}

/** Validate script storage before accepting settings.
 * @param value Untrusted persisted section.
 */
export function validateBalanceScripts(value: unknown): asserts value is Record<string, BalanceScriptEntry> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Invalid balance scripts')
  for (const [provider, raw] of Object.entries(value)) {
    if (!validProviderId(provider)
      || !raw || typeof raw !== 'object' || Array.isArray(raw)) throw new TypeError('Invalid balance script provider')
    const entry = raw as BalanceScriptEntry
    if (!Number.isSafeInteger(entry.revision) || entry.revision < 1 || typeof entry.script !== 'string'
      || Buffer.byteLength(entry.script) > 32_768
      || Object.keys(entry).some(key => !['revision', 'script'].includes(key))) throw new TypeError('Invalid balance script entry')
  }
}

/** Concurrent edits to the same provider must be reviewed before replacement. */
export class BalanceScriptConflictError extends Error {
  constructor() { super('Balance script revision conflict') }
}
