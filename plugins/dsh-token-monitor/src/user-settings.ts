/**
 * 用户偏好的读写路径：把 cordis 注入的活 `Config` 对象包成 Host 内部使用的设置视图。
 *
 * 0.1.7 起写回由 settings 服务完成（`ctx.settings.update(ns, patch, expected)`），
 * 指向 profile 里的 patch 行；本模块只负责「读活值」和「重试/冲突判定」。
 * @module dsh-token-monitor/user-settings
 */

import type { Context } from '@deepseek-ai/cordis'
import { SettingsConflictError, type SettingsDescriptor } from '@deepseek-ai/dsh-settings'
import {
  DEFAULT_TOKEN_MONITOR_SETTINGS,
  pickPublicTokenMonitorSettings,
  type TokenMonitorSettings,
  type TokenMonitorSettingsPatch,
} from '@deepseek-ai/dsh-token-monitor-contract'
import { isVolatile } from '@deepseek-ai/cosmokit'
import { Config, TOKEN_MONITOR_VOLATILE_FIELDS, type ProviderNotificationOverrides, type TokenMonitorUserConfig } from './config-base.ts'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'

declare module '@deepseek-ai/cordis' {
  interface Events {
    /** Legacy namespace providers emit after persisting a changed resolved value.
     * @param ns Updated namespace.
     * @param next New resolved value.
     * @param prev Previous resolved value.
     * @param source Update origin.
     * @mode emit
     */
    'settings/updated'(ns: SettingsNamespace, next: unknown, prev: unknown, source: 'update' | 'provider'): void
  }
}

/** 持久化命名空间：就是 profile 配置项 id，改名会让旧设置失去归属。 */
export const TOKEN_MONITOR_SETTINGS_NS = 'dsh-token-monitor'

/** Namespace providers require consumer registration; profile providers own it in the Loader. */
export function registerUserSettings(ctx: Context, entry: TokenMonitorUserConfig): void {
  const provider = ctx.settings as typeof ctx.settings & {
    register?: (ns: string, schema: typeof Config, options: { base: TokenMonitorUserConfig }) => unknown
  }
  if (typeof provider.register === 'function' && descriptorFor(ctx) === undefined) {
    provider.register(TOKEN_MONITOR_SETTINGS_NS, Config, { base: entry })
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 判断 provider id 是否可用作对象键与日志标签。 */
export function validProviderId(provider: string): boolean {
  return provider.length > 0 && provider.length <= 256
    && !['__proto__', 'prototype', 'constructor'].includes(provider)
}

/** 展开一个可能是 volatile 引用的字段。 */
function plain(value: unknown): unknown {
  return isVolatile(value) ? value.get() : value
}

/** 把活 `Config` 对象读成纯值；缺字段回落到默认值。 */
export function readUserConfig(config: TokenMonitorUserConfig): TokenMonitorUserConfig {
  const read = (config ?? {}) as unknown as Record<string, unknown>
  const resolved = { ...DEFAULT_TOKEN_MONITOR_SETTINGS } as unknown as Record<string, unknown>
  for (const field of TOKEN_MONITOR_VOLATILE_FIELDS) {
    const value = plain(read[field])
    if (value !== undefined) resolved[field] = value
  }
  const overrides = plain(read.providerNotifications)
  resolved.providerNotifications = isRecord(overrides) ? overrides : {}
  return resolved as unknown as TokenMonitorUserConfig
}

/**
 * 从 settings 服务的活描述符读出本插件的合并后配置。
 *
 * `descriptor.value` 是 schema 解析后的活值（base 与用户段落已合并，volatile 字段仍是
 * 引用），因此在任何 fiber 上都拿得到当前生效配置；宿主 fiber 的 `ctx.fiber.config`
 * 只在本插件条目自己的 fiber 里才有值，跨越调用点时会读到空对象。
 * @param ctx 任意持有 settings 服务的上下文。
 * @param ns 配置项 id，缺省为本插件的命名空间。
 * @returns 活配置对象；命名空间不可寻址时返回空对象。
 */
export function liveUserConfig(ctx: Context, ns = TOKEN_MONITOR_SETTINGS_NS): TokenMonitorUserConfig {
  const value = descriptorFor(ctx, ns)?.value
  return (isRecord(value) ? value : {}) as unknown as TokenMonitorUserConfig
}

/** 读取当前生效的命名空间描述符；条目尚未挂载或未声明 volatile 时返回 undefined。 */
export function descriptorFor(ctx: Context, ns = TOKEN_MONITOR_SETTINGS_NS): SettingsDescriptor | undefined {
  return ctx.settings?.describe?.()?.find(candidate => candidate.ns === ns)
}

/** 读取当前 revision；命名空间不可寻址时回落到 0（该状态下写入本来就会失败）。 */
export function resolveConfigRevision(ctx: Context, ns = TOKEN_MONITOR_SETTINGS_NS): number {
  return descriptorFor(ctx, ns)?.revision ?? 0
}

/**
 * 设置写入在命名空间暂时不可寻址时也无法通过重试修复。
 * @param error 一次写入尝试抛出的错误。
 * @returns true 表示重试不会改变结果。
 */
export function isPermanentSettingsError(error: unknown): boolean {
  return error instanceof TypeError || !(error instanceof Error)
    || /No configurable plugin entry|has no volatile fields|is not volatile/.test(error.message)
}

/** 重试判据：只有版本冲突值得重读一次描述符再写。 */
function isRetryable(error: unknown): boolean {
  return (error instanceof SettingsConflictError || isRecord(error) && error.code === 'SETTINGS_CONFLICT')
    && !isPermanentSettingsError(error)
}

/**
 * 在命名空间上合并一次用户偏好，冲突时重读版本后重试。
 * @param ctx 拥有 settings 服务的上下文。
 * @param patch 要合并的字段；空对象表示无改动。
 * @param expectedRevision 调用方最后观察到的版本；缺省表示不检查。
 */
export async function writeUserConfig(
  ctx: Context,
  patch: TokenMonitorSettingsPatch,
  expectedRevision?: number,
  ns = TOKEN_MONITOR_SETTINGS_NS,
): Promise<void> {
  if (Object.keys(patch).length === 0) return
  for (let attempt = 0; attempt < 4; attempt++) {
    const descriptor = descriptorFor(ctx, ns)
    if (descriptor === undefined) throw new Error(`No configurable plugin entry "${ns}"`)
    const expected = expectedRevision === undefined
      ? descriptor.revision
      : expectedRevision
    try {
      await ctx.settings.mutate(ns, Object.entries(patch).map(([key, value]) => ({ op: 'set' as const, path: [key], value })), expected)
      return
    } catch (error) {
      if (isRetryable(error) && attempt < 3) continue
      if (isRetryable(error)) throw new SettingsConflictError(ns as SettingsNamespace, expected, resolveConfigRevision(ctx, ns))
      throw error
    }
  }
}

/** 按 provider 解析提醒字段，同时保留全局显示偏好。
 * @param stored 当前校验过的用户配置。
 * @param provider 精确的已配置 provider id。
 * @returns 该 provider 视角的公开设置。
 */
export function readProviderSettings(stored: TokenMonitorUserConfig, provider: string): TokenMonitorSettings {
  if (provider === 'deepseek-official') return pickPublicTokenMonitorSettings(stored as unknown as Record<string, unknown>)
  return {
    ...DEFAULT_TOKEN_MONITOR_SETTINGS, peakReminderEnabled: false, wechatNotificationsEnabled: false,
    ...stored.providerNotifications?.[provider], displayMode: stored.displayMode, showWhaleGirl: stored.showWhaleGirl, animationScale: stored.animationScale,
  }
}

/** 读取一位 provider 的覆盖字段，做边界校验后返回。 */
export function readProviderOverrides(stored: TokenMonitorUserConfig, provider: string): ProviderNotificationOverrides[string] {
  return stored.providerNotifications?.[provider] ?? {}
}
