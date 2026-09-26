/**
 * 会话行金额共享逻辑：正式席位组件（SessionCostBadge）与旧宿主兼容桥
 * （LegacySessionCostBridge）共用一个金额读取与格式化函数，保证两处落点
 * 文案与数值一致（与旧版 apply-sidebar-integration.ps1 的格式约定相同：
 * <0.01 保留四位，否则两位，均带 ¥ 前缀）。
 */

/** tokenCost 投影的局部结构（不引入额外包依赖，只取 cost 字段）。 */
export interface SessionCostProjectionLike {
  tokenCost?: { cost?: number } | undefined
}

export function asSessionCostProjection(value: unknown): SessionCostProjectionLike | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  return value as SessionCostProjectionLike
}

/** Official conversation header action seat for the session cost badge. */
export const SESSION_HEADER_ACTIONS_SLOT = 'conversation.session.header.actions'

/** 宿主正式席位键：ui-workspace 声明的 sidebar.workspaces.sessionRow.trailing。 */
export const SESSION_ROW_TRAILING_SLOT = 'sidebar.workspaces.sessionRow.trailing'

/** 会话行金额节点的统一 data 标记。 */
export const SESSION_COST_MARKER = 'data-dsh-token-monitor-session-cost'

/** 新增会话行金额节点的统一中文提示。 */
export const SESSION_COST_TITLE = '会话消费金额'

/** 旧补丁脚本（rc.5/rc.7 apply-sidebar-integration.ps1）写入的历史英文提示，仅用于识别既有节点。 */
export const SESSION_COST_LEGACY_TITLE = 'Session cost'

/**
 * 从会话投影值读取可展示金额：缺失、非有限或非正数一律不展示。
 * @param projection - Session projection values, or undefined before projection is available.
 * @returns A positive finite cost, or undefined when the projection is not displayable.
 */
export function readSessionCost(projection: SessionCostProjectionLike | undefined): number | undefined {
  const cost = projection?.tokenCost?.cost
  return typeof cost === 'number' && Number.isFinite(cost) && cost > 0 ? cost : undefined
}

/**
 * 金额格式：小金额保留四位（如 ¥0.0080），普通金额两位（如 ¥38.60）。
 * @param cost - Positive session cost in CNY.
 * @returns A CNY label with precision appropriate for small charges.
 */
export function formatSessionCost(cost: number): string {
  return `¥${cost < 0.01 ? cost.toFixed(4) : cost.toFixed(2)}`
}
