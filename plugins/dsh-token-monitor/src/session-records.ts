/**
 * 会话用量记录的宿主兼容前置检查。
 *
 * 本插件写入的 token-usage/record 对宿主来说是仓库外的事件类型：读取端只有在事件带持久化的
 * ignorable: true 时才允许跳过它（packages/core/session/src/known-event-types.ts 与
 * packages/session/session-persistence/src/storage-contract.ts 的判定），而没有标记的未知事件
 * 会让整份会话日志被拒绝解释，历史会话直接打不开。
 *
 * 标记能否落盘取决于宿主 Session.append 是否把 ignorable 转发进 surface metadata，而这件事
 * 版本号反映不出来：已发布的 @deepseek-ai/dsh-session 0.1.7-alpha.2 与 0.1.7-rc.2 都只转发
 * sourceEventSeqs/surfaceOp（issue #24 第二位报告者给出了发布包证据），仓库检出的 harness 源码里
 * 才有转发实现。因此这里直接读宿主入口文件确认转发是否存在，并保留「写入后回读 event，标记丢失
 * 即永久停写」的兜底。
 * @module dsh-token-monitor/session-records
 */

import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { TokenUsageRecordData, UsageRecord } from './types.ts'

/** 显式放开写入的环境变量：宿主实现无法读取、但人工确认可用时使用。 */
export const FORCE_SESSION_RECORDS_ENV = 'DSH_TOKEN_MONITOR_FORCE_SESSION_RECORDS'

/** 宿主 append 转发 ignorable 时，元数据构造里必然出现这一项。 */
export const IGNORABLE_FORWARD_PATTERN = /surfaceOpts\s*\??\.\s*ignorable/u

/** 会话用量记录的写入能力。 */
export type SessionRecordCapability = 'supported' | 'unsupported' | 'unknown'

/** 供界面展示的写入能力状态。 */
export interface SessionRecordStatus {
  readonly capability: SessionRecordCapability
  readonly hostVersion?: string
  readonly hostEntry?: string
  readonly detail: string
  readonly forced: boolean
}

/** 读到的宿主实现：入口路径、版本与源码；读取失败时只有说明。 */
export interface HostSessionImplementation {
  readonly entry?: string
  readonly version?: string
  readonly source?: string
  readonly detail: string
}

function defaultReadHostImplementation(): HostSessionImplementation {
  const require = createRequire(import.meta.url)
  let entry: string
  try {
    entry = require.resolve('@deepseek-ai/dsh-session')
  } catch (error) {
    return { detail: '无法从插件位置解析 @deepseek-ai/dsh-session：' + String((error as Error)?.message ?? error) }
  }
  let version: string | undefined
  try {
    const manifest = require(require.resolve('@deepseek-ai/dsh-session/package.json')) as { version?: unknown }
    if (typeof manifest.version === 'string' && manifest.version !== '') version = manifest.version
  } catch { version = undefined }
  try {
    return {
      entry,
      source: readFileSync(entry, 'utf8'),
      detail: '宿主实现来自 ' + entry,
      ...(version === undefined ? {} : { version }),
    }
  } catch (error) {
    return {
      entry,
      detail: '无法读取宿主实现 ' + entry + '：' + String((error as Error)?.message ?? error),
      ...(version === undefined ? {} : { version }),
    }
  }
}

/** 读取宿主 @deepseek-ai/dsh-session 的入口实现。
 * @param read 覆盖默认读取（测试用）。
 * @returns 入口、版本与源码。
 */
export function readHostSessionImplementation(read: () => HostSessionImplementation = defaultReadHostImplementation): HostSessionImplementation {
  return read()
}

/** 判定宿主实现能否安全写入：源码里确认转发才允许，读不到一律停写。
 * @param implementation 宿主实现。
 * @returns 写入能力与可展示的说明。
 */
export function capabilityForHostImplementation(implementation: HostSessionImplementation): { capability: SessionRecordCapability; detail: string } {
  if (implementation.source === undefined) return { capability: 'unknown', detail: implementation.detail }
  if (IGNORABLE_FORWARD_PATTERN.test(implementation.source)) {
    return { capability: 'supported', detail: implementation.detail + '，已确认 append 转发 ignorable' }
  }
  const version = implementation.version === undefined ? '版本未知' : '@deepseek-ai/dsh-session ' + implementation.version
  return {
    capability: 'unsupported',
    detail: version + ' 的 append 不转发 ignorable（' + implementation.detail + '），写入的记录会让整份会话日志打不开',
  }
}

export interface SessionRecordWriterOptions {
  readonly readHostImplementation?: () => HostSessionImplementation
  readonly force?: boolean
  readonly onStop?: (status: SessionRecordStatus) => void
}

/**
 * 会话用量行的唯一写入出口。命中停写条件时直接返回 false，写入方无需再判断宿主。
 */
export class SessionRecordWriter {
  private readonly options: SessionRecordWriterOptions
  private statusValue: SessionRecordStatus
  private stopped = false

  constructor(options: SessionRecordWriterOptions = {}) {
    this.options = options
    const forced = options.force ?? process.env[FORCE_SESSION_RECORDS_ENV] === '1'
    const implementation = readHostSessionImplementation(options.readHostImplementation)
    const verdict = capabilityForHostImplementation(implementation)
    this.statusValue = {
      capability: verdict.capability,
      detail: verdict.detail,
      forced,
      ...implementation.version === undefined ? {} : { hostVersion: implementation.version },
      ...implementation.entry === undefined ? {} : { hostEntry: implementation.entry },
    }
  }

  /** 当前能力状态（不可变副本）。 */
  status(): SessionRecordStatus { return { ...this.statusValue } }

  /** 是否仍会写入会话用量行。 */
  enabled(): boolean {
    if (this.stopped) return false
    return this.statusValue.forced || this.statusValue.capability === 'supported'
  }

  /**
   * 写入一条用量记录，并确认宿主真的落盘了 ignorable 标记。
   * @param session 目标会话。
   * @param record 已入账的用量记录。
   * @returns 写入并确认成功时为 true；停写、跳过或写入失败时为 false。
   */
  append(session: Session, record: UsageRecord): boolean {
    if (!this.enabled()) return false
    let event: SessionEvent
    try {
      event = session.append('token-usage/record', { record } satisfies TokenUsageRecordData, { ignorable: true }) as SessionEvent
    } catch (error) {
      console.warn('[dsh-token-monitor] 用量行追加失败，持久账本已保留:', String(error))
      return false
    }
    if (event.ignorable === true) return true
    this.stopped = true
    this.statusValue = {
      ...this.statusValue,
      capability: 'unsupported',
      detail: '宿主写入时丢掉了 ignorable 标记，已停止写入会话用量记录；已写入的这一条可能需要在宿主侧修复',
    }
    this.options.onStop?.(this.status())
    return false
  }
}
