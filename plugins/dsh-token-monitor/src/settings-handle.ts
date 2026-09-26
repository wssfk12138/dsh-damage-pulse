/**
 * 设置访问句柄：把「活 Config + 自有状态」合成各 feature 需要的读接口。
 *
 * 句柄在 `loader/volatile-update` 时重读活值，因此面板改完立刻对记账、提醒、
 * 路由生效，不需要重启，也不需要把 writable 状态缓存下来。
 * @module dsh-token-monitor/settings-handle
 */

import type { TokenMonitorSettings } from '@deepseek-ai/dsh-token-monitor-contract'
import type { TokenMonitorUserConfig } from './config-base.ts'
import type { TokenMonitorStore } from './plugin-store.ts'
import { PRICE_TABLE, type PricingTable } from './pricing.ts'
import { readProviderSettings, readUserConfig } from './user-settings.ts'

/** 供可选模块与核心共享的只读视图。 */
export interface TokenMonitorSettingsHandle {
  /** 全局用户偏好（已展开 volatile 引用）。 */
  user(): TokenMonitorUserConfig
  /** 某位 provider 视角的公开设置。 */
  forProvider(provider: string): TokenMonitorSettings
  /** 内部定价覆盖。 */
  priceTable(): PricingTable
}

export function createSettingsHandle(
  /** 活配置来源：给出本插件条目的活值（`descriptor.value` 或本 fiber 的 `ctx.fiber.config`）。 */
  readConfig: () => TokenMonitorUserConfig,
  store: TokenMonitorStore,
): TokenMonitorSettingsHandle {
  return {
    user: () => readUserConfig(readConfig()),
    forProvider: provider => readProviderSettings(readUserConfig(readConfig()), provider),
    priceTable: () => store.get().priceTable ?? PRICE_TABLE,
  }
}
