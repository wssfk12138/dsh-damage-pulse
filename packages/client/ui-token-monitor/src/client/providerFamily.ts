/**
 * DeepSeek 官方计费路由的判定与展示归一。
 *
 * 账号路由（deepseek-account）与官方 API key 路由（deepseek-official）在 Host 侧同族同价：
 * 记录里两种 id 都可能出现。任何“列出供应商”的界面都必须把同族合成一条，不能重复显示。
 */

/** DeepSeek 官方计费路由的全部 provider id；与 Host 的 OFFICIAL_PROVIDER_IDS 对齐。 */
export const OFFICIAL_PROVIDER_IDS = ['deepseek-official', 'deepseek-account'] as const

/** provider 是否走 DeepSeek 官方计费路由（含账号路由）。 */
export function isOfficialRoute(provider: string | undefined): boolean {
  return provider !== undefined && (OFFICIAL_PROVIDER_IDS as readonly string[]).includes(provider)
}

/** 展示用的稳定 provider id：官方族成员统一落到 deepseek-official。 */
export function displayProviderId(provider: string): string {
  return isOfficialRoute(provider) ? 'deepseek-official' : provider
}
