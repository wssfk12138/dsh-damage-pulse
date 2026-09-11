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

/**
 * 宿主正式席位键：ui-conversation 的 conversation.session.header.actions，
 * 即会话标题旁的 actions 列表（0.1.5-alpha 与 rc.7 都声明；席位 scope 为
 * session，标准 kit 提供 sessionId 与 useSessions，徽标组件无需改动）。
 */
export const SESSION_HEADER_ACTIONS_SLOT = 'conversation.session.header.actions'

/**
 * 会话行席位键：sidebar.workspaces.sessionRow.trailing。上游 ui-workspace
 * （0.1.3/0.1.5）都未声明该席位，只有本机补丁宿主会声明；仅在声明时注册。
 */
export const SESSION_ROW_TRAILING_SLOT = 'sidebar.workspaces.sessionRow.trailing'

/** 会话行金额节点的统一 data 标记。 */
export const SESSION_COST_MARKER = 'data-dsh-token-monitor-session-cost'

/** 新增会话行金额节点的统一中文提示。 */
export const SESSION_COST_TITLE = '会话消费金额'

/** 旧补丁脚本（rc.5/rc.7 apply-sidebar-integration.ps1）写入的历史英文提示，仅用于识别既有节点。 */
export const SESSION_COST_LEGACY_TITLE = 'Session cost'

/**
 * 从会话投影值读取可展示金额：缺失、非有限或非正数一律不展示。
 */
export function readSessionCost(projection: SessionCostProjectionLike | undefined): number | undefined {
  const cost = projection?.tokenCost?.cost
  return typeof cost === 'number' && Number.isFinite(cost) && cost > 0 ? cost : undefined
}

/**
 * 金额格式：小金额保留四位（如 ¥0.0080），普通金额两位（如 ¥38.60）。
 */
export function formatSessionCost(cost: number): string {
  return `¥${cost < 0.01 ? cost.toFixed(4) : cost.toFixed(2)}`
}
