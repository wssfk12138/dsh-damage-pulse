/**
 * Token 用量与金额面板插件，browser half：对话流内的「单次用量行」
 * （conversation.chat.node）+ 输入区的「会话累计条」（conversation.composer.dock）
 * + frame 级「余额悬浮卡片」（shell.overlay）。
 * 用量行/累计条为投影与事件驱动；余额卡片为 HTTP 轮询，无自有 store。
 */
// Plugin-owned design tokens: the public host does not define these aliases.
import './theme-tokens.css'
import type { ModelDirectoryResolver } from '@deepseek-ai/dsh-client-ui-model-selection/client'
// Type-only：拉入 conversation slot 契约（chat.node / composer.dock）。
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only：新版 Chat 包拥有 conversation.chat.node 的 keyed slot 声明。
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
// Type-only: session controller capability augmentation (useSessions/useProjection).
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
// Type-only: resource capability augmentation supplied by the host resource plugin.
import type {} from '@deepseek-ai/dsh-client-resources/client'
// Type-only：拉入 layout 的 shell.overlay slot 契约。
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import { BalanceWidget } from './BalanceWidget.tsx'
import { createModuleState, moduleInstalled } from './moduleApi.ts'
import { createDisplayScopeLoader } from './displayScope.ts'
import type { ClientContextLike, ModelCatalogConnectionLike } from './host-contracts.ts'
import type { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { zh, en } from './detail-locales.ts'
import { createBillingEvents } from './billingEvents.ts'
import * as overviewFeature from './module-overview.ts'
import * as billingFeature from './module-billing.ts'

/** 核心依赖：slot 注册 + Host 连接。旧版 Conversation Node 注册表按需使用。 */
export const inject = ['slots', 'connection', 'remote.session', 'modelDirectories', 'locale']

export function apply(ctx: ClientContextLike): void {
  ctx.effect(() => (ctx.get('locale') as LocaleRuntime).register('token-monitor.details', { zh, en }), 'token-monitor: detail dictionaries')
  const modelDirectories = ctx.get('modelDirectories') as ModelDirectoryResolver
  const remote = ctx.get('remote') as ModelCatalogConnectionLike['remote']
  const loadModelCatalog = async () => {
    const result = await remote.session.modelCatalog()
    if (!result.ok || !result.value) throw new Error('Host model catalog unavailable')
    return result.value
  }
  const loadDisplayScope = createDisplayScopeLoader(modelDirectories, loadModelCatalog)
  const billingEvents = createBillingEvents()
  ctx.effect(() => () => billingEvents.dispose(), 'token-monitor: billing events')

  const modules = createModuleState()
  billingEvents.setEnabled(false)
  const active = new Map<string, () => void>()
  const loading = new Map<string, object>()
  let disposed = false
  const reconcile = () => {
    const state = modules.getSnapshot()
    billingEvents.setEnabled(moduleInstalled(state, 'billing'))
    for (const id of ['overview', 'billing']) {
      if (!moduleInstalled(state, id)) {
        loading.delete(id)
        active.get(id)?.()
        active.delete(id)
        continue
      }
      if (active.has(id) || loading.has(id)) continue
      const token = {}
      loading.set(id, token)
      const feature = id === 'overview' ? overviewFeature : billingFeature
      try {
        if (!disposed && loading.get(id) === token && moduleInstalled(modules.getSnapshot(), id)) {
          active.set(id, feature.activate(ctx, modules))
        }
      } catch (error) {
        console.error('Token monitor UI module failed to load', id, error)
      } finally {
        if (loading.get(id) === token) loading.delete(id)
      }
    }
    if (state?.pluginRemoved && !state.cleanupPending) { removeWidget(); disposeOptional() }
  }
  const disposeOptional = () => {
    loading.clear()
    for (const remove of active.values()) remove()
    active.clear()
  }
  const removeWidget = ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay', id: 'token-monitor-balance', locale: 'token-monitor.details',
    inject: () => ({ loadDisplayScope, loadModelCatalog, refreshModules: modules.refresh, hooks: { billingEvents, modules } }),
  }, BalanceWidget))
  ctx.effect(() => {
    const unsubscribe = modules.subscribe(reconcile)
    return () => { disposed = true; unsubscribe(); disposeOptional(); removeWidget(); modules.dispose() }
  }, 'token-monitor: installed module seats')
}
