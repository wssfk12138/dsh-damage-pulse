import { createTokenCostProjectionDefinition } from './projection.ts'
import { migrateMissingTokenCost } from './migration.ts'
/** Raw capture and common settings remain resident while optional features are removed. */
import type { Context } from '@deepseek-ai/cordis'
import type { ModuleServices } from './module-services.ts'
import { attachUsageCollector } from './collector-core.ts'
import { SessionRecordWriter } from './session-records.ts'
import { registerHostCompatRoute } from './host-compat-route.ts'
import { attachDisplayScope, registerDisplayScopeRoute } from './display-scope.ts'
import { registerSessionCostsRoute } from './session-costs-route.ts'
import { UsageStorage } from './storage.ts'
import { DetailStore, attachDetails } from './details.ts'
import { registerTokenMonitorSettingsRoute } from './settings.ts'
import { PRICE_TABLE } from './pricing.ts'
import { ModuleWork } from './module-work.ts'
import { TOKEN_MONITOR_INTERNAL_FIELDS, TOKEN_MONITOR_OWNED_FIELDS, TOKEN_MONITOR_VOLATILE_FIELDS } from './config-base.ts'
import { TokenMonitorStore } from './plugin-store.ts'
import { createSettingsHandle } from './settings-handle.ts'
import { TOKEN_MONITOR_SETTINGS_NS, liveUserConfig, writeUserConfig } from './user-settings.ts'
import { prepareLegacySettings } from './legacy-settings.ts'

/** Optional launcher services exposed by profile based hosts. */
interface ProfileContextLike { readonly home: string }
interface LoaderLike { await(): Promise<unknown> }

export async function createServices(ctx: Context, assetRoot: string, dataDir: string): Promise<ModuleServices> {
  const store = new TokenMonitorStore(dataDir)
  await store.load()
  const profileContext = ctx.get('profileContext') as ProfileContextLike | undefined
  const loader = ctx.get('loader') as LoaderLike | undefined
  const legacy = profileContext ? await prepareLegacySettings(profileContext.home, store) : undefined
  if (legacy !== undefined && loader !== undefined) {
    void loader.await().then(async () => {
      await writeUserConfig(ctx, legacy)
      await store.update({ legacyMigrationVersion: 1 })
      ctx.logger.info('token-monitor: imported legacy preferences and owned state')
    }).catch((error: unknown) => ctx.logger.error('token-monitor: legacy migration incomplete', error))
  }
  // 活配置通过 settings descriptor 读取：宿主 fiber 的 config 可能为空，
  // descriptor.value 才是 base 与用户段落合并后的权威值。
  const settings = createSettingsHandle(() => liveUserConfig(ctx, TOKEN_MONITOR_SETTINGS_NS) ?? {}, store)
  return {
    assetRoot, store, settings,
    priceTable: () => settings.priceTable() ?? PRICE_TABLE,
    readProvider: provider => settings.forProvider(provider),
    storage: new UsageStorage(() => true, dataDir), details: new DetailStore(dataDir),
  }
}

export function apply(ctx: Context, services: ModuleServices, installed: (id: string) => boolean): { drainSettings(): Promise<void> } {
  ctx.inject(['sessionProjections'], projection => {
    projection.effect(() => projection.sessionProjections.register(createTokenCostProjectionDefinition(services.priceTable())), 'token-monitor: usage projection')
  })
  ctx.inject(['sessionProjections', 'sessionProjectionCache', 'sessionPersistence'], migrateMissingTokenCost)
  const work = new ModuleWork()
  ctx.effect(() => () => work.stop(), 'token-monitor: settings writes')
  // 宿主未确认会落盘 ignorable 标记时不写会话用量行：没有标记的未知事件会让整份
  // 会话日志被读取端拒绝解释（issue #24），停写后金额仍由插件账本与兜底路由提供。
  const sessionRecords = new SessionRecordWriter({
    onStop: status => ctx.logger.warn(`token-monitor: ${status.detail}`),
  })
  if (!sessionRecords.enabled()) {
    const status = sessionRecords.status()
    ctx.logger.warn(`token-monitor: 已停写会话用量记录（capability=${status.capability}）：${status.detail}`)
  }
  attachUsageCollector(ctx, services.storage, {
    readBilling: () => services.billing?.readSnapshot(),
    priceRecord: (record, frozen) => services.billing?.priceRecord(record, frozen) ?? record,
    onPersistedRecord: (record, kind) => { services.billing?.onPersistedRecord(record, kind); services.observeRecord?.(record, kind) },
    appendUsageRecord: (session, record) => { sessionRecords.append(session, record) },
  })
  attachDetails(ctx, services.details, services.priceTable())
  const routes = attachDisplayScope(ctx)
  ctx.inject(['webServer', 'connection'], web => {
    registerDisplayScopeRoute(web, routes)
    registerSessionCostsRoute(web, () => services.storage.list())
    registerHostCompatRoute(web, () => sessionRecords.status())
    registerTokenMonitorSettingsRoute(web, services.settings, {
      allowed: key => Object.entries(TOKEN_MONITOR_OWNED_FIELDS).some(([id, keys]) => keys.includes(key) && installed(id)),
      run: action => work.run(action),
    })
  })
  return { drainSettings: () => work.drain() }
}

/** User choices affect plugin-owned files/settings only; host credentials and session logs are shared. */
export async function eraseData(ctx: Context, services: ModuleServices, id: string, selection: { configuration: boolean; history: boolean }): Promise<void> {
  if (selection.configuration) {
    const keys = id === 'plugin' ? TOKEN_MONITOR_VOLATILE_FIELDS : TOKEN_MONITOR_OWNED_FIELDS[id] ?? []
    const paths = keys.filter(key => !TOKEN_MONITOR_INTERNAL_FIELDS.includes(key)).map(key => [key])
    if (id === 'notify' || id === 'wechat') {
      for (const provider of Object.keys(services.settings.user().providerNotifications ?? {})) {
        for (const key of keys) paths.push(['providerNotifications', provider, key])
      }
    }
    if (paths.length) await ctx.settings.mutate(TOKEN_MONITOR_SETTINGS_NS, paths.map(path => ({ op: 'unset' as const, path })))
    // 内部账本不属于 profile patch，走自有状态重置。
    if (id === 'plugin') await services.store.reset()
    else if (id === 'billing') await services.store.update({
      billing: undefined, balanceScripts: undefined, balanceProviders: undefined,
      balanceEndpoints: undefined, balanceEndpointPolicyVersion: 0,
    } as never)
  }
  if (!selection.history) return
  if (id === 'plugin' || id === 'overview') { services.storage.clear(); services.details.clear() }
  else if (id === 'billing') services.storage.clearBilling()
}
