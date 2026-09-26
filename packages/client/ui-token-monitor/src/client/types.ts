/**
 * Client 半的类型表：tokenCost 投影值、token-usage/record 事件数据与
 * Conversation Node data 的声明合并。与 Host 插件（dsh-token-monitor）的
 * 定义保持一致（client 聚合独立编译，故在此重复声明）。
 * @module @deepseek-ai/dsh-client-ui-token-monitor/client
 */

/** 单次模型调用的用量与金额记录（wire 值，与 Host UsageRecord 对齐）。 */
export interface TokenUsageRecord {
  sessionId: string
  turn: number
  step: number
  sourceEventSeq?: number
  timestamp: number
  provider: string
  model: string
  inputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  outputTokens: number
  reasoningTokens: number
  costInput: number
  costCache: number
  costCacheRead: number
  costCacheWrite: number
  costOutput: number
  cost: number
  peak: boolean
}

/** tokenCost 投影的 wire 值：会话累计用量与金额。 */
export interface TokenCostProjection {
  calls: number
  inputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  outputTokens: number
  totalTokens: number
  cost: number
  lastActivity: number
}

/** Provider balance snapshot; generation metadata prevents cross-credential comparisons. */
export interface BalanceInfo {
  provider?: string
  scriptRevision?: number
  credentialGeneration?: string
  currency: string
  totalBalance: number
  grantedBalance: number
  toppedUpBalance: number
  isAvailable: boolean
  updatedAt: number
}

/** Host 按北京时间自然日聚合的今日花费。 */
export interface TodaySpendInfo {
  date: string
  timeZone: 'Asia/Shanghai'
  currency: 'CNY'
  cost: number
  calls: number
  updatedAt: number
}

/** Time range accepted by usage-summary aggregation. */
export type UsageSummaryRange = 'all' | '30d' | '7d' | 'yesterday' | 'today' | 'custom'

/** Aggregated token usage, cost, and cache metrics for a selected range. */
export interface UsageSummary {
  range: UsageSummaryRange
  from: string | null
  to: string
  spendCny: number | null
  requestCount: number
  totalTokens: number
  cacheHitTokens: number
  cacheHitRate: number
  activeDays: number
  costPer100mTokensCny: number | null
  activeDaySpendCny: number | null
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    /** 会话累计 token 用量与金额。 */
    tokenCost: TokenCostProjection
  }
}

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface ChatNodeDataMap {
    /** 对话流内「单次用量行」的 data。 */
    'token-usage': TokenUsageRecord
  }
}
