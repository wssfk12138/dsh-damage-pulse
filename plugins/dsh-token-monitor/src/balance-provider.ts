/** Resolve only the selected provider's current explicit credential reference. */
import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import type {} from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-settings'
import type { BalanceIdentity } from './balance-registry.ts'
import type { BalanceProviderEntry } from './balance-storage.ts'
import { isOfficialProvider } from './pricing.ts'

/** Read the provider profile via its owning adapter's settings directory.
 * @param ctx Context with LLM, settings and credentials.
 * @param provider Exact configured route.
 * @returns Key and endpoint for server-internal use, or undefined when unavailable.
 */
export async function resolveBalanceIdentity(
  ctx: Context,
  provider: string,
  balanceProvider?: BalanceProviderEntry,
): Promise<BalanceIdentity | undefined> {
  if (balanceProvider !== undefined) {
    const resolved = await ctx.credentials.resolve(credentialRef(balanceProvider.apiKeyEnv))
    if (!resolved?.value) return undefined
    return { apiKey: resolved.value, baseURL: balanceProvider.baseURL }
  }
  const descriptor = ctx.llm.listConfigurableProviders().find(item => item.provider === provider)
  if (!descriptor || descriptor.error) return undefined
  // 活配置里没有该 namespace 的描述符时视为不可解析。
  let profile: unknown = ctx.settings.describe().find(item => item.ns === descriptor.settingsNs)?.value
  for (const key of descriptor.settingsPath) {
    if (!profile || typeof profile !== 'object') return undefined
    profile = (profile as Record<string, unknown>)[key]
  }
  if (!profile || typeof profile !== 'object') return undefined
  const fields = profile as Record<string, unknown>
  const official = isOfficialProvider(provider)
    && (descriptor.settingsNs === 'llm-deepseek' || descriptor.settingsNs === 'llm-deepseek-account')
  const ref = fields.apiKeyEnv ?? (official ? 'DEEPSEEK_API_KEY' : undefined)
  const baseURL = fields.baseURL ?? (official ? launchEnvironmentOf(ctx).get('DEEPSEEK_BASE_URL')?.value ?? 'https://api.deepseek.com' : undefined)
  if (typeof ref !== 'string' || !ref || typeof baseURL !== 'string') return undefined
  const resolved = await ctx.credentials.resolve(credentialRef(ref))
  if (!resolved?.value) return undefined
  return { apiKey: resolved.value, baseURL }
}
