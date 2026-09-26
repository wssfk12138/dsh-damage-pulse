import type { InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import { moduleInstalled, type createModuleState } from './moduleApi.ts'
/**
 * 单次用量行 renderer：对话流内紧凑展示一次模型调用的 token 与金额。
 * 无 locale（文案硬编码中文），无 CSS module（内联样式，M4 验证用）。
 */
import { memo } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { TokenUsageRecord } from './types.ts'
import type {} from './usage-node.ts'

type UsageNodeViewProps = PropsRuntime<'conversation.chat.node', 'token-usage'> & Partial<InjectFace<{ hooks: { modules: ReturnType<typeof createModuleState> } }>>

const ROW: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'baseline',
  gap: 8,
  padding: '3px 10px',
  fontSize: 12,
  lineHeight: '18px',
  color: 'var(--dsh-color-text-secondary, #888)',
  fontVariantNumeric: 'tabular-nums',
}

const COST: React.CSSProperties = {
  fontWeight: 600,
  color: 'var(--dsh-color-accent, #4c8dff)',
}

/** 把大 token 数格式化为 1.2k / 3.4M 的紧凑形式。 */
function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

/** 金额格式：保留足够小数位，极小值也用科学计数兜底。 */
function fmtCost(n: number): string {
  if (n === 0) return '¥0'
  if (n < 0.0001) return `¥${n.toExponential(2)}`
  if (n < 0.01) return `¥${n.toFixed(5)}`
  return `¥${n.toFixed(4)}`
}

export const UsageNodeView = memo(function UsageNodeView({ node, useModules }: UsageNodeViewProps) {
  const billing = useModules?.(state => moduleInstalled(state, 'billing')) ?? true
  const r: TokenUsageRecord = node.data
  const total = r.inputTokens + r.cacheReadTokens + r.cacheWriteTokens + r.outputTokens
  const cache = r.cacheReadTokens > 0 ? ` · 缓存 ${fmtTokens(r.cacheReadTokens)}` : ''
  return (
    <div style={ROW} data-token-usage="">
      <span>{r.model}</span>
      <span>↑ {fmtTokens(r.inputTokens + r.cacheWriteTokens)}{cache}</span>
      <span>↓ {fmtTokens(r.outputTokens)}</span>
      <span>∑ {fmtTokens(total)} tok</span>
      {billing && <span>{r.peak ? '峰时' : '谷时'}</span>}
      {billing && <span style={COST}>{fmtCost(r.cost)}</span>}
    </div>
  )
})
