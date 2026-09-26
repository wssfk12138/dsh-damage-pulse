/**
 * 插件自身的 `Config` schema 基座：只放用户偏好，不放运行态账本。
 *
 * 0.1.7 起 settings 由「插件注册的独立文档」改成「插件自己的 Config schema +
 * `volatile()` 标记 + 写回 profile patch」。仅有声明了 volatile 的字段才会出现在
 * 设置面板里，也才能被写入；因此每个用户可见字段都必须显式下标记。
 *
 * 独立成模块是为了让不依赖 cordis 运行时的纯逻辑（校验、合成）能单独引用，
 * 不把整个 loader 组合拖进消费方的图里。
 * @module dsh-token-monitor/config-base
 */

import z from '@deepseek-ai/schemastery'
import {
  DEFAULT_TOKEN_MONITOR_SETTINGS,
  TOKEN_MONITOR_MAX_DAILY_BUDGET_CNY,
  type TokenMonitorSettings,
  type TokenMonitorSettingsPatch,
} from '@deepseek-ai/dsh-token-monitor-contract'

/** 每个 provider 可覆盖的提醒字段；显示偏好属全局字段，不允许在此出现。 */
export type ProviderNotificationOverrides = Record<string, TokenMonitorSettingsPatch>

/** 用户可见配置的解析结果：纯值，不含 volatile 引用。 */
export interface TokenMonitorUserConfig extends TokenMonitorSettings {
  providerNotifications: ProviderNotificationOverrides
}

const providerOverrides: z<ProviderNotificationOverrides> = z.dict(z.any()) as unknown as z<ProviderNotificationOverrides>

/**
 * 用户可见配置。字段与 {@link TokenMonitorSettings} 一一对应，默认值取自
 * contract 里的 `DEFAULT_TOKEN_MONITOR_SETTINGS`，边界沿用迁移前的校验。
 */
export const Config = z.object({
  displayMode: z.union(['balance', 'spend'] as const).default(DEFAULT_TOKEN_MONITOR_SETTINGS.displayMode).volatile(),
  showWhaleGirl: z.boolean().default(DEFAULT_TOKEN_MONITOR_SETTINGS.showWhaleGirl).volatile(),
  dailyBudgetEnabled: z.boolean().default(DEFAULT_TOKEN_MONITOR_SETTINGS.dailyBudgetEnabled).volatile(),
  dailyBudgetCny: z.number()
    .min(Number.MIN_VALUE)
    .max(TOKEN_MONITOR_MAX_DAILY_BUDGET_CNY)
    .default(DEFAULT_TOKEN_MONITOR_SETTINGS.dailyBudgetCny)
    .volatile(),
  budgetExceededNotificationEnabled: z.boolean().default(DEFAULT_TOKEN_MONITOR_SETTINGS.budgetExceededNotificationEnabled).volatile(),
  peakReminderEnabled: z.boolean().default(DEFAULT_TOKEN_MONITOR_SETTINGS.peakReminderEnabled).volatile(),
  peakReminderEnterPeak: z.boolean().default(DEFAULT_TOKEN_MONITOR_SETTINGS.peakReminderEnterPeak).volatile(),
  peakReminderEnterValley: z.boolean().default(DEFAULT_TOKEN_MONITOR_SETTINGS.peakReminderEnterValley).volatile(),
  notifyOncePerTransition: z.boolean().default(DEFAULT_TOKEN_MONITOR_SETTINGS.notifyOncePerTransition).volatile(),
  whaleBubbleEnabled: z.boolean().default(DEFAULT_TOKEN_MONITOR_SETTINGS.whaleBubbleEnabled).volatile(),
  wechatNotificationsEnabled: z.boolean().default(DEFAULT_TOKEN_MONITOR_SETTINGS.wechatNotificationsEnabled).volatile(),
  cacheHitAnomalyNotificationEnabled: z.boolean().default(DEFAULT_TOKEN_MONITOR_SETTINGS.cacheHitAnomalyNotificationEnabled).volatile(),
  cacheHitAnomalyThreshold: z.number().min(0).max(100).default(DEFAULT_TOKEN_MONITOR_SETTINGS.cacheHitAnomalyThreshold).volatile(),
  cacheHitAnomalyConsecutiveCalls: z.number().min(2).max(20).default(DEFAULT_TOKEN_MONITOR_SETTINGS.cacheHitAnomalyConsecutiveCalls).volatile(),
  /** 逐 provider 的提醒覆盖；对象递归合并，改一家不会清掉另一家。 */
  providerNotifications: providerOverrides.default({}).volatile(),
})

/** 设置面板分组用的字段归属；客户端与擦除路径共用同一份清单。 */
export const TOKEN_MONITOR_OWNED_FIELDS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  pet: Object.freeze(['showWhaleGirl']),
  overview: Object.freeze(['displayMode']),
  billing: Object.freeze(['billing', 'balanceScripts', 'balanceProviders', 'balanceEndpoints', 'balanceEndpointPolicyVersion']),
  notify: Object.freeze([
    'dailyBudgetEnabled', 'dailyBudgetCny', 'budgetExceededNotificationEnabled', 'peakReminderEnabled',
    'peakReminderEnterPeak', 'peakReminderEnterValley', 'notifyOncePerTransition', 'whaleBubbleEnabled',
    'cacheHitAnomalyNotificationEnabled', 'cacheHitAnomalyThreshold', 'cacheHitAnomalyConsecutiveCalls',
  ]),
  wechat: Object.freeze(['wechatNotificationsEnabled']),
})

/** 面板字段的完整清单：写入设置面板用，也是「未安装模块」门禁的白名单来源。 */
export const TOKEN_MONITOR_VOLATILE_FIELDS: readonly string[] = Object.freeze([
  'displayMode', 'showWhaleGirl', 'dailyBudgetEnabled', 'dailyBudgetCny', 'budgetExceededNotificationEnabled',
  'peakReminderEnabled', 'peakReminderEnterPeak', 'peakReminderEnterValley', 'notifyOncePerTransition',
  'whaleBubbleEnabled', 'wechatNotificationsEnabled', 'cacheHitAnomalyNotificationEnabled',
  'cacheHitAnomalyThreshold', 'cacheHitAnomalyConsecutiveCalls', 'providerNotifications',
])

/** 迁到插件自有 JSON 状态、不再属于 profile patch 的内部字段。 */
export const TOKEN_MONITOR_INTERNAL_FIELDS: readonly string[] = Object.freeze([
  'schemaVersion', 'priceTable', 'billing', 'balanceScripts', 'balanceProviders', 'balanceEndpoints',
  'balanceEndpointPolicyVersion',
])

/** 判断 provider id 是否可用作对象键与日志标签。 */
export function validProviderId(provider: string): boolean {
  return provider.length > 0 && provider.length <= 256
    && !['__proto__', 'prototype', 'constructor'].includes(provider)
}
