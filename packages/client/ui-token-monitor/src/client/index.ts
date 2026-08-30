/**
 * Token 用量与金额面板插件，browser half：对话流内的「单次用量行」
 * （conversation.chat.node）+ 输入区的「会话累计条」（conversation.composer.dock）
 * + frame 级「余额悬浮卡片」（shell.overlay）。
 * 用量行/累计条为投影与事件驱动；余额卡片为 HTTP 轮询，无自有 store。
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
// Type-only：拉入 conversation slot 契约（chat.node / composer.dock）。
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only：拉入 layout 的 shell.overlay slot 契约。
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import { tokenUsageNodeDefinition } from './usage-node.ts'
import { UsageNodeView } from './UsageNodeView.tsx'
import { SessionStatsBar } from './SessionStatsBar.tsx'
import { BalanceWidget } from './BalanceWidget.tsx'
import { SessionCostBadge } from './SessionCostBadge.tsx'
import { LegacySessionCostBridge } from './LegacySessionCostBridge.tsx'
import { SESSION_ROW_TRAILING_SLOT } from './sessionCost.ts'
import { createRouteEligibilityLoader } from './routeEligibility.ts'

export { UsageNodeView } from './UsageNodeView.tsx'
export { SessionStatsBar } from './SessionStatsBar.tsx'
export { BalanceWidget } from './BalanceWidget.tsx'
export { SessionCostBadge } from './SessionCostBadge.tsx'
export { LegacySessionCostBridge } from './LegacySessionCostBridge.tsx'
export {
  formatSessionCost,
  readSessionCost,
  SESSION_COST_MARKER,
  SESSION_COST_TITLE,
  SESSION_ROW_TRAILING_SLOT,
} from './sessionCost.ts'
export type { SessionCostProjectionLike } from './sessionCost.ts'
export {
  createTokenMonitorSettingsApi,
  TokenMonitorSettingsApiError,
  TokenMonitorSettingsProtocolError,
} from './settingsApi.ts'
export type { TokenMonitorSettingsApi } from './settingsApi.ts'
export type {
  TokenMonitorDisplayMode,
  TokenMonitorSettings,
  TokenMonitorSettingsPatch,
  TokenMonitorSettingsPatchRequest,
  TokenMonitorSettingsSnapshot,
} from '../../../../util/token-monitor-contract/src/index.ts'
export type { BalanceInfo, TokenCostProjection, TokenUsageRecord } from './types.ts'
export {
  createTokenMonitorUpdateApi,
  TokenMonitorUpdateApiError,
  TokenMonitorUpdateProtocolError,
} from './updateApi.ts'
export type {
  TokenMonitorInstallResult,
  TokenMonitorUpdateApi,
  TokenMonitorUpdateAsset,
  TokenMonitorUpdateStatus,
} from './updateApi.ts'

/** 核心依赖：slot 注册 + Host 连接。旧版 Conversation Node 注册表按需使用。 */
export const inject = ['slots', 'connection']

/**
 * ui-workspace 未纳入本包依赖：sessionRow 席位经该结构签名擦除后注册，
 * 运行时 keys 与宿主声明保持一致。
 */
type ErasedSlotRegister = (
  options: { name: string; key?: string; id?: string; order?: number; inject?: () => Record<string, unknown> },
  component: unknown,
) => () => void

export function apply(ctx: ClientContext): void {
  const connection = ctx.get('connection') as ConnectionHandle
  const loadRouteEligibility = createRouteEligibilityLoader(connection.api.sessions)

  // F1：单次用量行 —— 旧宿主提供 conversationEvents 时注册。0.1.2-alpha.1
  // 已移除此服务，不能让可选的明细行阻塞余额、累计条和侧栏金额启动。
  const conversationEvents = ctx.get('conversationEvents', false)
  if (conversationEvents !== undefined) {
    conversationEvents.register(tokenUsageNodeDefinition)
    ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({
      name: 'conversation.chat.node',
      key: 'token-usage',
    }, UsageNodeView))
  }

  // F2：会话累计条 —— 挂在输入区卡片下方（官方 stats line 同一位）。
  ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
    name: 'conversation.composer.dock',
    id: 'token-monitor-stats',
    order: 0,
  }, SessionStatsBar))

  // F3：余额悬浮卡片 —— frame 级浮动层（右下角），additive 席位。
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'token-monitor-balance',
    inject: () => ({ loadRouteEligibility }),
  }, BalanceWidget))

  // F4：会话行金额 —— 宿主声明的 sidebar.workspaces.sessionRow.trailing 通用席位
  // （标题与相对时间之间）。旧宿主未声明该席位时 slots.inject 等待声明，不会因
  // 未知席位启动崩溃；新宿主则由 SessionCostBadge 正式渲染。
  ctx.slots.inject(SESSION_ROW_TRAILING_SLOT as never, () =>
    (ctx.slots.register as unknown as ErasedSlotRegister)(
      { name: SESSION_ROW_TRAILING_SLOT },
      SessionCostBadge as never,
    ))

  // F5：旧宿主兼容桥 —— shell.overlay 列表末尾的无视觉条目。新宿主（出现
  // data-session-id 或正式席位 marker）首次扫描即整体停用，不会与正式席位双写。
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'token-monitor-legacy-session-cost',
    order: 999,
  }, LegacySessionCostBridge))
}
