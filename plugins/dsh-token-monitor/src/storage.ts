/**
 * 会话累计存储 + 单次用量明细持久化（JSONL）。
 * 会话累计（tokenCost projection）已由 session-projection-cache 持久化；
 * 这里额外落盘单次用量明细，供历史查询与导出。
 * @module dsh-token-monitor/storage
 */

import { appendFileSync, mkdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { beijingDateKey } from './todaySpend.ts'
import { isValidUsageRecord, normalizeUsageRecord, type SessionSummary, type TodaySpendInfo, type UsageRecord } from './types.ts'

/** 明细数据目录：~/.dsh/data/dsh-token-monitor/ */
const DATA_DIR = join(homedir(), '.dsh', 'data', 'dsh-token-monitor')

/**
 * 明细去重身份。
 *
 * 当前采集器写入的记录携带 `sourceEventSeq`，用 (sessionId, seq) 作为全账本持久身份，
 * 拦得住长会话重放与进程重启后的重复投递；早于该字段的历史行没有 seq 可依据，
 * 退化为整行内容身份（调用定位 + 时间戳 + provider/model + token + 金额），
 * 保证冷启动回读与重复追加都只接受一次，同时不会合并两条内容不同的真实调用。
 */
function usageIdentity(record: UsageRecord): string {
  if (record.sourceEventSeq !== undefined) {
    return JSON.stringify(['seq', record.sessionId, record.sourceEventSeq])
  }
  return JSON.stringify([
    'content',
    record.sessionId,
    record.turn,
    record.step,
    record.timestamp,
    record.provider,
    record.model,
    record.inputTokens,
    record.cacheReadTokens,
    record.cacheWriteTokens,
    record.outputTokens,
    record.reasoningTokens,
    record.costInput,
    record.costCacheRead,
    record.costCacheWrite,
    record.costOutput,
    record.cost,
  ])
}

/** 存储层防御性资格门禁；历史原文件保留，只过滤运行时读取与新增。 */
export type UsageEligibility = (record: UsageRecord) => boolean

/** 按会话累计用量与金额，并追加持久化单次明细。 */
export class UsageStorage {
  private readonly summaries = new Map<string, SessionSummary>()
  private readonly records: UsageRecord[] = []
  private readonly dailySpend = new Map<string, { cost: number; calls: number }>()
  /** 已接受的明细去重身份；有 seq 的行走持久身份，历史无 seq 行退化为整行内容身份。 */
  private readonly seenSourceEvents = new Set<string>()
  private readonly isEligible: UsageEligibility
  private readonly dataDir: string

  constructor(isEligible: UsageEligibility, dataDir: string = DATA_DIR) {
    this.isEligible = isEligible
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
          if (record !== undefined && isValidUsageRecord(record) && this.isEligible(record)) {
            if (this.isDuplicateRecord(record)) continue
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
    if (!isValidUsageRecord(record) || !this.isEligible(record)) return undefined
    if (this.isDuplicateRecord(record)) return undefined
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

  /** 冷启动回读与新增共用同一身份集合：同一身份只接受第一条。 */
  private isDuplicateRecord(record: UsageRecord): boolean {
    const key = usageIdentity(record)
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
