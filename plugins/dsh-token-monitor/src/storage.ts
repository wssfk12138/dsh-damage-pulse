/**
 * 会话累计存储 + 单次用量明细持久化（JSONL）。
 * 会话累计（tokenCost projection）已由 session-projection-cache 持久化；
 * 这里额外落盘单次用量明细，供历史查询与导出。
 * @module dsh-token-monitor/storage
 */

import { appendFileSync, mkdirSync, readFileSync } from 'node:fs'
import { replaceHistoryFile } from './history-file.ts'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import { join } from 'node:path'
import { beijingDateKey } from './todaySpend.ts'
import { isValidUsageRecord, normalizeUsageRecord, type SessionSummary, type TodaySpendInfo, type UsageRecord } from './types.ts'

/** 明细数据目录：~/.dsh/data/dsh-token-monitor/ */
const DATA_DIR = dshHomePath('data', 'dsh-token-monitor')

  /** 保留参数用于兼容既有构造器；历史记录按写入时状态读取，不按当前规则重算。 */
export type UsageEligibility = (record: UsageRecord) => boolean

/** 按会话累计用量与金额，并追加持久化单次明细。 */
export class UsageStorage {
  private readonly summaries = new Map<string, SessionSummary>()
  private readonly records: UsageRecord[] = []
  private readonly dailySpend = new Map<string, { cost: number; calls: number }>()
  private readonly seenSourceEvents = new Set<string>()
  private readonly dataDir: string

  /** Clear plugin-owned history without touching host session logs. */
  clear(): void {
    this.replaceHistory([])
  }

  /** Erase saved monetary decisions while retaining token usage; never reprice. */
  clearBilling(): void {
    this.replaceHistory(this.records.map(record => {
      const cleared: UsageRecord = { ...record, cost: 0, costInput: 0, costOutput: 0,
        costCache: 0, costCacheRead: 0, costCacheWrite: 0, billingStatus: 'unpriced', peak: false }
      delete cleared.billingRule
      delete cleared.billingApplied
      delete cleared.billingReason
      delete cleared.billingRuleVersion
      delete cleared.modelMultiplier
      return cleared
    }))
  }

  private replaceHistory(records: UsageRecord[]): void {
    replaceHistoryFile(join(this.dataDir, 'usage.jsonl'), records.map(record => JSON.stringify(record) + '\n').join(''))
    this.records.length = 0
    this.summaries.clear(); this.dailySpend.clear(); this.seenSourceEvents.clear()
    this.loadHistory()
  }

  constructor(_isEligible: UsageEligibility, dataDir: string = DATA_DIR) {
    this.dataDir = dataDir
    try {
      mkdirSync(this.dataDir, { recursive: true })
    } catch (error) {
      console.warn(`[dsh-token-monitor] 创建数据目录失败: ${String(error)}`)
    }
    this.loadHistory()
  }

  /** 冷启动回读历史明细（fail-soft：文件缺失/损坏行静默跳过）。 */
  private loadHistory(): void {
    try {
      const text = readFileSync(join(this.dataDir, 'usage.jsonl'), 'utf8')
      let excluded = 0
      for (const line of text.split('\n')) {
        const trimmed = line.trim()
        if (trimmed === '') continue
        try {
          const record = normalizeUsageRecord(JSON.parse(trimmed))
          if (record !== undefined && isValidUsageRecord(record)) {
            if (this.isDuplicateSourceEvent(record)) continue
            this.records.push(record)
            this.summaries.set(record.sessionId, this.fold(record))
            this.addToDailySpend(record)
          }
          else excluded++
        } catch {
          // 跳过损坏的行
        }
      }
      if (this.records.length > 0) {
        console.log(`[dsh-token-monitor] 已加载 ${this.records.length} 条历史明细`)
      }
      if (excluded > 0) {
        console.log(`[dsh-token-monitor] 已从运行时汇总排除 ${excluded} 条不合格历史明细（原始 JSONL 未修改）`)
      }
    } catch {
      // 首次运行无文件，静默
    }
  }

  /** 将明细折叠到会话摘要；冷启动与新增路径共用，避免摘要状态分叉。 */
  private fold(record: UsageRecord): SessionSummary {
    const prev = this.summaries.get(record.sessionId)
    if (prev === undefined) {
      return {
        sessionId: record.sessionId,
        calls: 1,
        inputTokens: record.inputTokens,
        cacheReadTokens: record.cacheReadTokens,
        cacheWriteTokens: record.cacheWriteTokens,
        outputTokens: record.outputTokens,
        totalTokens: record.inputTokens + record.cacheReadTokens + record.cacheWriteTokens + record.outputTokens,
        cost: record.cost,
        lastActivity: record.timestamp,
      }
    }
    return {
      ...prev,
      calls: prev.calls + 1,
      inputTokens: prev.inputTokens + record.inputTokens,
      cacheReadTokens: prev.cacheReadTokens + record.cacheReadTokens,
      cacheWriteTokens: prev.cacheWriteTokens + record.cacheWriteTokens,
      outputTokens: prev.outputTokens + record.outputTokens,
      totalTokens: prev.totalTokens + record.inputTokens + record.cacheReadTokens + record.cacheWriteTokens + record.outputTokens,
      cost: prev.cost + record.cost,
      lastActivity: record.timestamp,
    }
  }

  /** 将合格明细累加到北京时间日期索引，避免今日消费查询重复扫描全部历史。 */
  private addToDailySpend(record: UsageRecord): void {
    if (record.billingStatus !== undefined && record.billingStatus !== 'priced') return
    const date = beijingDateKey(record.timestamp)
    const previous = this.dailySpend.get(date)
    if (previous === undefined) {
      this.dailySpend.set(date, { cost: record.cost, calls: 1 })
      return
    }
    previous.cost += record.cost
    previous.calls += 1
  }

  /** 把一条单次记录累加到对应会话，并追加持久化明细。 */
  add(record: UsageRecord): SessionSummary | undefined {
    if (!isValidUsageRecord(record)) return undefined
    if (this.isDuplicateSourceEvent(record)) return undefined
    const next = this.fold(record)
    this.summaries.set(record.sessionId, next)

    // 明细：内存缓存 + JSONL 追加（fail-soft，落盘失败不影响运行时）。
    this.records.push(record)
    this.addToDailySpend(record)
    try {
      appendFileSync(join(this.dataDir, 'usage.jsonl'), `${JSON.stringify(record)}\n`, 'utf8')
    } catch (error) {
      console.warn(`[dsh-token-monitor] 明细落盘失败: ${String(error)}`)
    }

    return next
  }

  private isDuplicateSourceEvent(record: UsageRecord): boolean {
    if (record.sourceEventSeq === undefined) return false
    const key = JSON.stringify([record.sessionId, record.sourceEventSeq])
    if (this.seenSourceEvents.has(key)) return true
    this.seenSourceEvents.add(key)
    return false
  }

  get(sessionId: string): SessionSummary | undefined {
    return this.summaries.get(sessionId)
  }

  list(): SessionSummary[] {
    return [...this.summaries.values()]
  }

  /** 单次用量明细（可按会话过滤）。 */
  history(sessionId?: string): UsageRecord[] {
    if (sessionId === undefined) return [...this.records]
    return this.records.filter((record) => record.sessionId === sessionId)
  }

  /** 按北京时间自然日聚合当前运行时已通过资格门禁的记录。 */
  todaySpend(now = Date.now()): TodaySpendInfo {
    const date = beijingDateKey(now)
    const summary = this.dailySpend.get(date)
    return {
      date,
      timeZone: 'Asia/Shanghai',
      currency: 'CNY',
      cost: summary?.cost ?? 0,
      calls: summary?.calls ?? 0,
      updatedAt: now,
    }
  }
}
