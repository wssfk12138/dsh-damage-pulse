import type { UsageRecord } from './types.ts'

export interface CacheHitAnomalySettings {
  enabled: boolean
  thresholdPercent: number
  consecutiveCalls: number
}

export interface CacheHitAnomalyNotificationPayload {
  /** Monotonic runtime episode identity; it is not persisted across Host restarts. */
  episodeId: number
  observedRate: number
  threshold: number
  sampleCount: number
  consecutiveCalls: number
  observedAt: number
}

export interface CacheHitAnomalyDetector {
  observe(record: UsageRecord): CacheHitAnomalyNotificationPayload | undefined
  reset(): void
}

export function formatCacheHitAnomalyMessage(payload: CacheHitAnomalyNotificationPayload): string {
  return [
    '【dsh-damage-pulse · 缓存小警报】',
    '',
    '鲸鱼娘发现缓存命中率有点低啦 (｡•́︿•̀｡)',
    '',
    `最近 ${String(payload.sampleCount)} 次合格调用的聚合命中率约为 ${(payload.observedRate * 100).toFixed(1)}%，低于设定阈值 ${(payload.threshold * 100).toFixed(0)}%。`,
    '',
    '建议检查一下最近调用的缓存复用情况哦～',
    '我会继续帮你认真盯着！',
  ].join('\n')
}

interface Sample {
  inputTokens: number
  cacheReadTokens: number
  observedAt: number
}

/**
 * Runtime-only detector for low cache hit rate. It deliberately has no disk
 * state: a Host restart starts a fresh episode and never backfills alerts.
 */
export function createCacheHitAnomalyDetector(
  readSettings: () => CacheHitAnomalySettings,
): CacheHitAnomalyDetector {
  let samples: Sample[] = []
  let episodeLatched = false
  let episodeId = 0
  let settingsFingerprint = ''

  const reset = (): void => {
    samples = []
    episodeLatched = false
  }

  const observe = (record: UsageRecord): CacheHitAnomalyNotificationPayload | undefined => {
    const settings = readSettings()
    const fingerprint = `${String(settings.enabled)}:${String(settings.thresholdPercent)}:${String(settings.consecutiveCalls)}`
    if (fingerprint !== settingsFingerprint) {
      settingsFingerprint = fingerprint
      reset()
    }
    if (!settings.enabled) {
      reset()
      return undefined
    }
    if (!Number.isSafeInteger(settings.consecutiveCalls) || settings.consecutiveCalls < 2) {
      reset()
      return undefined
    }
    if (!Number.isSafeInteger(record.timestamp) || record.timestamp < 0) return undefined
    if (!Number.isFinite(record.inputTokens) || !Number.isFinite(record.cacheReadTokens)
      || record.inputTokens < 0 || record.cacheReadTokens < 0) return undefined
    const denominator = record.inputTokens + record.cacheReadTokens
    if (!Number.isFinite(denominator) || denominator <= 0) return undefined

    samples.push({
      inputTokens: record.inputTokens,
      cacheReadTokens: record.cacheReadTokens,
      observedAt: record.timestamp,
    })
    if (samples.length > settings.consecutiveCalls) samples = samples.slice(-settings.consecutiveCalls)
    if (samples.length < settings.consecutiveCalls) return undefined

    const inputTokens = samples.reduce((sum, sample) => sum + sample.inputTokens, 0)
    const cacheReadTokens = samples.reduce((sum, sample) => sum + sample.cacheReadTokens, 0)
    const total = inputTokens + cacheReadTokens
    if (total <= 0) return undefined
    const observedRate = cacheReadTokens / total
    const threshold = Math.max(0, Math.min(100, settings.thresholdPercent)) / 100
    if (observedRate >= threshold) {
      episodeLatched = false
      return undefined
    }
    if (episodeLatched) return undefined
    episodeLatched = true
    episodeId += 1
    return {
      episodeId,
      observedRate,
      threshold,
      sampleCount: samples.length,
      consecutiveCalls: settings.consecutiveCalls,
      observedAt: samples[samples.length - 1]!.observedAt,
    }
  }

  return { observe, reset }
}
