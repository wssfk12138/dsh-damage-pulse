import { PluginStoreConflictError, type TokenMonitorStore } from './plugin-store.ts'
import type { BalanceEndpoint } from './balance-storage.ts'
import { evaluateBalanceScript, validateBalanceRequest } from './balance-script.ts'
import { refuseScriptLiteral } from './script-literals.ts'

/** Version of the approved-endpoint policy once seeded; a later save never re-seeds. */
export const BALANCE_ENDPOINT_POLICY_VERSION = 1

/** Carry over endpoints of adapters that were already saved and running before approvals existed.
 * Only read-only GET targets are carried over; a write target always needs an explicit approval,
 * and the version marker makes this a single startup pass instead of a standing auto-approval.
 */
export async function migrateBalanceEndpointPolicy(store: TokenMonitorStore): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const current = store.get()
    if ((current.balanceEndpointPolicyVersion ?? 0) >= BALANCE_ENDPOINT_POLICY_VERSION) return
    const seeded: Record<string, BalanceEndpoint[]> = {}
    for (const [provider, entry] of Object.entries(current.balanceScripts ?? {})) {
      seeded[provider] = await seedsFromSavedScript(entry.script)
    }
    const balanceEndpoints = { ...seeded, ...(current.balanceEndpoints ?? {}) }
    try {
      await store.update({
        balanceEndpoints,
        balanceEndpointPolicyVersion: BALANCE_ENDPOINT_POLICY_VERSION,
      }, current.revision)
      return
    } catch (error) {
      if (error instanceof PluginStoreConflictError && attempt < 2) continue
      throw error
    }
  }
}

/** Endpoints a saved adapter may keep without a fresh approval. */
async function seedsFromSavedScript(script: string): Promise<BalanceEndpoint[]> {
  if (!script.trim() || refuseScriptLiteral(script) !== undefined) return []
  try {
    const request = validateBalanceRequest(await evaluateBalanceScript(script))
    return request.method === 'GET' ? [{ path: request.path, method: 'GET' }] : []
  } catch {
    return []
  }
}
