import type { InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import { moduleInstalled, type createModuleState } from './moduleApi.ts'
import { LEDGER_COST_TITLE, ledgerSessionEntry, useSessionLedger } from './sessionLedger.ts'
/**
 * 会话累计条：挂在输入区卡片下方的环境读数带（conversation.composer.dock），
 * 读自 tokenCost session projection（whole value，由 history 尾页 seed、
 * session/projection 帧更新），无 store、无事件监听。
 */
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { TokenCostProjection } from './types.ts'

type SessionStatsBarProps = PropsRuntime<'conversation.composer.dock'> & Partial<InjectFace<{ hooks: { modules: ReturnType<typeof createModuleState> } }>>

const BAR: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'baseline',
  gap: 10,
  fontSize: 12,
  lineHeight: '16px',
  color: 'var(--dsh-color-text-secondary, #888)',
  fontVariantNumeric: 'tabular-nums',
}

const COST: React.CSSProperties = {
  fontWeight: 600,
  color: 'var(--dsh-color-accent, #4c8dff)',
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

function fmtCost(n: number): string {
  if (n === 0) return '¥0'
  if (n < 0.0001) return `¥${n.toExponential(2)}`
  if (n < 0.01) return `¥${n.toFixed(5)}`
  return `¥${n.toFixed(4)}`
}

export function SessionStatsBar({ useProjection, useModules, sessionId }: SessionStatsBarProps) {
  const billing = useModules?.(state => moduleInstalled(state, 'billing')) ?? true
  const projection = useProjection('tokenCost')
  const ledger = useSessionLedger()
  // undefined = 能力缺失或加载中；null 或 0 次调用 = 暂无数据。
  if (projection === undefined || projection === null) return null
  const p = projection as TokenCostProjection
  // 账本是消费的权威记录：日志折叠可能因事件缺失而少算甚至为零，因此金额更大的一方胜出。
  const fallback = ledgerSessionEntry(ledger, sessionId)
  const ledgerWins = fallback !== undefined && fallback.cost > p.cost
  if (!ledgerWins && p.calls === 0) return null
  const view = ledgerWins && fallback !== undefined
    ? {
      cost: fallback.cost,
      totalTokens: fallback.totalTokens,
      calls: fallback.calls,
      inputTokens: fallback.inputTokens,
      cacheWriteTokens: fallback.cacheWriteTokens,
      outputTokens: fallback.outputTokens,
      fromLedger: true,
    }
    : {
      cost: p.cost,
      totalTokens: p.totalTokens,
      calls: p.calls,
      inputTokens: p.inputTokens,
      cacheWriteTokens: p.cacheWriteTokens,
      outputTokens: p.outputTokens,
      fromLedger: false,
    }
  return (
    <div
      style={BAR}
      data-token-monitor-stats=""
      title={view.fromLedger ? LEDGER_COST_TITLE : undefined}
      {...(view.fromLedger ? { 'data-dsh-token-monitor-stats-source': 'ledger' } : {})}
    >
      <span>本次会话</span>
      {billing && <span style={COST}>{fmtCost(view.cost)}</span>}
      <span>{fmtTokens(view.totalTokens)} tokens</span>
      <span>{view.calls} 次调用</span>
      <span>↑ {fmtTokens(view.inputTokens + view.cacheWriteTokens)}</span>
      <span>↓ {fmtTokens(view.outputTokens)}</span>
    </div>
  )
}
