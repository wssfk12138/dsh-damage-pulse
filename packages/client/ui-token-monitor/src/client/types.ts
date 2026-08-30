/**
 * Client 半的类型表：复用 Host wire 类型，并补充 Conversation Node data 声明。
 * @module @deepseek-ai/dsh-client-ui-token-monitor/client
 */

import type {
  TokenCostProjection as HostTokenCostProjection,
  TokenUsageRecordData,
  UsageRecord,
} from '../../../../../plugins/dsh-token-monitor/src/types.ts'

/** 单次模型调用的用量与金额记录（wire 值，与 Host UsageRecord 对齐）。 */
export type TokenUsageRecord = UsageRecord

/** tokenCost 投影的 wire 值：会话累计用量与金额。 */
export type TokenCostProjection = HostTokenCostProjection

/** DeepSeek 账户余额（与 Host BalanceInfo 对齐）。 */
export interface BalanceInfo {
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

export type UsageSummaryRange = 'all' | '30d' | '7d' | 'today'

export interface UsageSummary {
  range: UsageSummaryRange
  from: string | null
  to: string
  spendCny: number
  requestCount: number
  totalTokens: number
  cacheHitTokens: number
  cacheHitRate: number
  activeDays: number
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** 一次模型调用的 token 用量与金额（仅日志事件，供用量行回放）。 */
    'token-usage/record': TokenUsageRecordData
  }
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    /** 会话累计 token 用量与金额。 */
    tokenCost: HostTokenCostProjection
  }
}

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface ChatNodeDataMap {
    /** 对话流内「单次用量行」的 data。 */
    'token-usage': TokenUsageRecord
  }
}
