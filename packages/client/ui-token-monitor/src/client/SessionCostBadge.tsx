/**
 * 会话行金额（正式席位版本）：挂在宿主声明的
 * sidebar.workspaces.sessionRow.trailing 通用席位上（标题与相对时间之间）。
 *
 * 金额读自 useSessions 列表投影 tokenCost；缺失、零值或非有限值不显示。
 * 视觉与旧版兼容桥保持一致（旧 apply-sidebar-integration.ps1 的 .cost 落点）。
 * 本包不依赖 ui-workspace：props 使用局部结构类型（宿主 owner 提供 sessionId，
 * 全局 kit 提供 useSessions），席位键经类型擦除后注册。
 */
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId, SessionListStateLike } from './host-contracts.ts'
import {
  formatSessionCost,
  readSessionCost,
  SESSION_COST_MARKER,
  SESSION_COST_TITLE,
} from './sessionCost.ts'

/** 宿主 owner share（{ sessionId }）与全局 kit（useSessions）的局部结构。 */
export interface SessionCostBadgeProps {
  /** 行的稳定会话 id（宿主行元素同时镜像为 data-session-id）。 */
  sessionId: SessionId
  /** 全局会话列表选择器钩子。 */
  useSessions: SnapshotSelectorHook<SessionListStateLike>
}

const BADGE: React.CSSProperties = {
  flex: 'none',
  marginRight: 12,
  fontSize: 12,
  lineHeight: '20px',
  color: '#4176e6',
  fontVariantNumeric: 'tabular-nums',
}

/**
 * 会话行金额徽标：仅在会话存在且投影金额为正有限值时渲染。
 * @param props - 席位 owner 与全局钩子。
 * @returns 金额节点，或 null。
 */
export function SessionCostBadge({ sessionId, useSessions }: SessionCostBadgeProps) {
  const cost = useSessions(state => readSessionCost(state.byId[sessionId]?.projectionValues))
  if (cost === undefined) return null
  return (
    <span style={BADGE} {...{ [SESSION_COST_MARKER]: '' }} title={SESSION_COST_TITLE}>
      {formatSessionCost(cost)}
    </span>
  )
}
