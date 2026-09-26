/** Shared live services passed explicitly to independently loaded optional modules. */
import type { Context } from '@deepseek-ai/cordis'
import type { TokenMonitorSettings } from '@deepseek-ai/dsh-token-monitor-contract'
import type { TokenMonitorStore } from './plugin-store.ts'
import type { TokenMonitorSettingsHandle } from './settings-handle.ts'
import type { PricingTable } from './pricing.ts'
import type { UsageStorage } from './storage.ts'
import type { DetailStore } from './details.ts'
import type { UsageRecord } from './types.ts'
import type { BillingSnapshot } from '@deepseek-ai/dsh-token-monitor-contract'
import type { WechatNotificationSender } from './wechat-gate.ts'

export interface ModuleServices {
  assetRoot: string
  storage: UsageStorage
  details: DetailStore
  /** 插件自有状态（计费、余额脚本、端点审批）。 */
  store: TokenMonitorStore
  /** 活用户配置视图。 */
  settings: TokenMonitorSettingsHandle
  priceTable(): PricingTable
  readProvider(provider: string): TokenMonitorSettings
  billing?: {
    readSnapshot(): BillingSnapshot
    priceRecord(record: UsageRecord, frozen: BillingSnapshot | undefined): UsageRecord
    onPersistedRecord(record: UsageRecord, kind: 'normal' | 'miss'): void
  }
  observeRecord?: (record: UsageRecord, kind: 'normal' | 'miss') => void
  wechat?: WechatNotificationSender
}
export interface RuntimeFeature { apply(ctx: Context, services: ModuleServices): void | Promise<void> }
