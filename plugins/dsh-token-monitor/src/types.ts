/**
 * 数据模型与 SessionEventMap 声明合并。
 * @module dsh-token-monitor/types
 */

import { validateBillingRules, validateBillingApplied } from '@deepseek-ai/dsh-token-monitor-contract'

/** 单次模型调用的用量与金额记录（可 JSON 序列化，用于持久化与客户端回放）。 */
export interface UsageRecord {
  sessionId: string
  turn: number
  step: number
  /** Originating session event sequence; present on records written by current collectors. */
  sourceEventSeq?: number
  timestamp: number
  provider: string
  model: string
  /** 缓存未命中输入 token。 */
  inputTokens: number
  /** 缓存命中读取 token。 */
  cacheReadTokens: number
  /** 缓存写入 token（DeepSeek 通常为 0/缺省）。 */
  cacheWriteTokens: number
  /** 输出 token（已含 reasoning，勿重复相加）。 */
  outputTokens: number
  /** 信息性字段：reasoning token 数，已含于 outputTokens。 */
  reasoningTokens: number
  costInput: number
  costCache: number
  costCacheRead: number
  costCacheWrite: number
  /** 旧 JSONL 没有独立缓存读写金额时为 false，仅用于历史展示。 */
  cacheBreakdownRecorded?: boolean
  costOutput: number
  cost: number
  /** 是否高峰时段计价。 */
  peak: boolean
  /** 记录生成时冻结的计费规则信息；旧记录没有这些字段时仍可读取。 */
  billingStatus?: 'priced' | 'unpriced' | 'disabled'
  billingRuleVersion?: number
  modelMultiplier?: number
  billingRule?: import('@deepseek-ai/dsh-token-monitor-contract').BillingModelRule
  billingApplied?: import('@deepseek-ai/dsh-token-monitor-contract').BillingApplied
  billingReason?: import('./billing.ts').BillingDecision['billingReason']
}

/**
 * Normalize durable usage rows written before cache read/write costs were split.
 * @param value Parsed JSONL value from durable history.
 * @returns A normalized candidate for strict validation, or undefined for non-object input.
 */
export function normalizeUsageRecord(value: unknown): UsageRecord | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const candidate = value as Record<string, unknown>
  const normalized: Record<string, unknown> = { ...candidate }
  if (!Object.prototype.hasOwnProperty.call(candidate, 'costCacheRead')) {
    normalized.costCacheRead = candidate.costCache
  }
  if (!Object.prototype.hasOwnProperty.call(candidate, 'costCacheWrite')) {
    normalized.costCacheWrite = 0
  }
  if (!Object.prototype.hasOwnProperty.call(candidate, 'costCacheRead') || !Object.prototype.hasOwnProperty.call(candidate, 'costCacheWrite')) {
    normalized.cacheBreakdownRecorded = false
  }
  return normalized as unknown as UsageRecord
}

export function isValidUsageRecord(record: UsageRecord): boolean {
  if (typeof record !== 'object' || record === null) return false
  if (![record.sessionId, record.provider, record.model].every(value => typeof value === 'string' && value.trim() !== '')) return false
  for (const value of [record.turn, record.step, record.timestamp, record.inputTokens, record.cacheReadTokens, record.cacheWriteTokens, record.outputTokens, record.reasoningTokens]) {
    if (!Number.isSafeInteger(value) || value < 0) return false
  }
  if (record.sourceEventSeq !== undefined && (!Number.isSafeInteger(record.sourceEventSeq) || record.sourceEventSeq < 0)) return false
  for (const value of [record.costInput, record.costCache, record.costCacheRead, record.costCacheWrite, record.costOutput, record.cost]) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return false
  }
  if (typeof record.peak !== 'boolean') return false
  if (record.billingStatus !== undefined && !['priced', 'unpriced', 'disabled'].includes(record.billingStatus)) return false
  if (record.billingStatus !== undefined && record.billingStatus !== 'priced' && record.cost !== 0) return false
  if (record.billingRuleVersion !== undefined && (!Number.isSafeInteger(record.billingRuleVersion) || record.billingRuleVersion < 0)) return false
  if (record.modelMultiplier !== undefined && (!Number.isFinite(record.modelMultiplier) || record.modelMultiplier <= 0)) return false
  if (record.billingReason !== undefined && !['provider-disabled', 'model-disabled', 'rule-missing', 'rate-missing', 'invalid-usage'].includes(record.billingReason)) return false
  if (record.cacheBreakdownRecorded !== undefined && typeof record.cacheBreakdownRecorded !== 'boolean') return false
  if (record.billingApplied !== undefined) {
    try { validateBillingApplied(record.billingApplied) } catch { return false }
  }
  if (record.billingRule !== undefined) {
    try {
      validateBillingRules({ version: 1, providers: [{ provider: record.provider, enabled: true, models: [record.billingRule] }] })
      if (record.billingRule.model !== record.model || record.billingRule.multiplier !== record.modelMultiplier) return false
    } catch { return false }
  }
  const cacheTotal = record.costCacheRead + record.costCacheWrite
  const componentTotal = record.costInput + cacheTotal + record.costOutput
  const tolerance = Math.max(1e-12, record.cost * 1e-9)
  return Number.isFinite(componentTotal)
    && Math.abs(record.costCache - cacheTotal) <= tolerance
    && Math.abs(record.cost - componentTotal) <= tolerance
}

/** 单个会话的累计用量与金额。 */
export interface SessionSummary {
  sessionId: string
  calls: number
  inputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  outputTokens: number
  /** input + cacheRead + cacheWrite + output 之和。 */
  totalTokens: number
  cost: number
  lastActivity: number
}

/** DeepSeek 账户余额。 */
export interface BalanceInfo {
  currency: string
  totalBalance: number
  grantedBalance: number
  toppedUpBalance: number
  isAvailable: boolean
  updatedAt: number
}

/** 北京时间自然日内的合格 DeepSeek 官方调用花费汇总。 */
export interface TodaySpendInfo {
  /** 北京时间下的 YYYY-MM-DD；协议字段仍使用 Asia/Shanghai 标识。 */
  date: string
  timeZone: 'Asia/Shanghai'
  currency: 'CNY'
  cost: number
  calls: number
  updatedAt: number
}

/** 追加到会话日志的「单次用量」仅日志事件 payload。 */
export interface TokenUsageRecordData {
  record: UsageRecord
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * 记录一次模型调用的 token 用量与金额。
     * 仅日志事件：不进入模型 surface / 派生历史，供 Web Client 回放渲染「单次用量行」。
     */
    'token-usage/record': TokenUsageRecordData
    /**
     * 同上；宿主读回旧代际 Session 时，把本插件自有的可忽略事件改名为
     * 「plugin:原名」并保留载荷与信封，因此持久化历史里同一份记录有两种事件名。
     */
    'plugin:token-usage/record': TokenUsageRecordData
  }
}

/** tokenCost projection 的 wire 值：单个会话的累计用量与金额（供 Web Client 会话统计条）。 */
export interface TokenCostProjection {
  calls: number
  /** 缓存未命中输入 token。 */
  inputTokens: number
  /** 缓存命中读取 token。 */
  cacheReadTokens: number
  /** 缓存写入 token。 */
  cacheWriteTokens: number
  /** 输出 token（已含 reasoning）。 */
  outputTokens: number
  /** input + cacheRead + cacheWrite + output 之和。 */
  totalTokens: number
  /** 累计金额（元）。 */
  cost: number
  /** 最后一次模型调用的时间戳。 */
  lastActivity: number
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    /** 会话累计 token 用量与金额。 */
    tokenCost: TokenCostProjection
  }

  interface SessionProjectionStateMap {
    /** Persisted fold state for the session token-cost projection. */
    tokenCost: TokenCostState
  }
}

/** Internal fold state for the tokenCost projection (persisted by DSH). */
export interface TokenCostState {
  calls: number
  inputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  outputTokens: number
  cost: number
  lastActivity: number
}
