type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

/** 宿主持久化「可忽略」标记的能力。 */
export type SessionRecordCapability = 'supported' | 'unsupported' | 'unknown'

/** 宿主兼容状态响应。 */
export interface HostCompatStatus {
  schemaVersion: 1
  sessionRecords: {
    capability: SessionRecordCapability
    hostVersion?: string
    detail: string
    forced: boolean
  }
}

/** 只读的宿主兼容状态接口。 */
export interface HostCompatApi {
  status(signal?: AbortSignal): Promise<HostCompatStatus>
}

const CAPABILITIES: readonly SessionRecordCapability[] = ['supported', 'unsupported', 'unknown']

/** 协议错误：宿主返回的兼容状态不符合契约。 */
export class HostCompatProtocolError extends Error {
  constructor(readonly field: string) {
    super(`宿主兼容接口返回了不符合契约的数据：${field}`)
    this.name = 'HostCompatProtocolError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 解析宿主兼容状态响应。
 * @param value 响应 JSON。
 * @returns 校验通过的状态。
 * @throws {HostCompatProtocolError} 字段缺失或类型不符。
 */
export function parseHostCompatStatus(value: unknown): HostCompatStatus {
  if (!isRecord(value)) throw new HostCompatProtocolError('body')
  if (value.schemaVersion !== 1) throw new HostCompatProtocolError('schemaVersion')
  const records = value.sessionRecords
  if (!isRecord(records)) throw new HostCompatProtocolError('sessionRecords')
  if (typeof records.capability !== 'string' || !CAPABILITIES.includes(records.capability as SessionRecordCapability)) throw new HostCompatProtocolError('sessionRecords.capability')
  if (typeof records.detail !== 'string') throw new HostCompatProtocolError('sessionRecords.detail')
  if (typeof records.forced !== 'boolean') throw new HostCompatProtocolError('sessionRecords.forced')
  if (records.hostVersion !== undefined && typeof records.hostVersion !== 'string') throw new HostCompatProtocolError('sessionRecords.hostVersion')
  return {
    schemaVersion: 1,
    sessionRecords: {
      capability: records.capability as SessionRecordCapability,
      detail: records.detail,
      forced: records.forced,
      ...records.hostVersion === undefined ? {} : { hostVersion: records.hostVersion },
    },
  }
}

/** 创建只读的宿主兼容状态客户端。
 * @param fetchImpl 可注入的 fetch。
 * @param path 路由路径。
 * @returns 只读客户端。
 */
export function createHostCompatApi(
  fetchImpl: FetchLike = fetch,
  path = '/api/token-monitor/host-compat',
): HostCompatApi {
  return {
    async status(signal) {
      const response = await fetchImpl(path, {
        ...signal === undefined ? {} : { signal },
        headers: { accept: 'application/json' },
      })
      if (!response.ok) throw new HostCompatProtocolError(`HTTP ${String(response.status)}`)
      return parseHostCompatStatus(await response.json())
    },
  }
}

/**
 * 设置页提示文案的开关。2026-09-29 用户决定先不展示该提示：会话用量已改由本地
 * 账本统计，界面再报「已停止写入会话日志」会让使用者误以为功能不可用。宿主补上
 * ignorable 转发后把这里改回 true 即可恢复，判定逻辑与状态数据都保持不动。
 */
const SHOW_HOST_COMPAT_HINT = false

/** 设置页提示文案：写入能力为 supported、或提示被关闭时返回 undefined。
 * @param status 宿主兼容状态。
 * @param show 是否允许展示；缺省取当前开关 SHOW_HOST_COMPAT_HINT，测试用它核对文案内容。
 * @returns 需要向用户展示的说明，或 undefined。
 */
export function hostCompatHint(status: HostCompatStatus, show = SHOW_HOST_COMPAT_HINT): string | undefined {
  if (!show) return undefined
  const { capability, hostVersion, detail } = status.sessionRecords
  if (capability === 'supported') return undefined
  if (capability === 'unsupported') {
    const detected = hostVersion === undefined ? '' : `（检测到 @deepseek-ai/dsh-session ${hostVersion}）`
    return `当前宿主的 @deepseek-ai/dsh-session${detected}不会把「可忽略」标记写进会话日志，插件已停止写入会话用量记录：没有标记的未知事件会让整份会话日志打不开。会话金额改用本地账本；等宿主发布包含该转发的版本后会自动恢复。`
  }
  return `无法读取宿主的 @deepseek-ai/dsh-session 实现（${detail}），插件已暂停写入会话用量记录，以免写坏历史会话。确认宿主会保留该标记时，可设置环境变量 DSH_TOKEN_MONITOR_FORCE_SESSION_RECORDS=1 显式开启。`
}
