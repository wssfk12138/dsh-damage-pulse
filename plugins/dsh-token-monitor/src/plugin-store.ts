/**
 * 插件自有持久化：承接「不是用户偏好」的内部状态。
 *
 * 0.1.7 起用户偏好搬进 profile patch 的 `Config`，但计费规则、余额脚本、
 * 已批准端点这类插件内部账本不适合写进 profile，也不再适合占用 home 的
 * settings.yaml。它们改为落在 `~/.dsh/data/dsh-token-monitor/state.json`，
 * 沿用 settings 的 `revision` 语义以保留 409 冲突协议与重试。
 * @module dsh-token-monitor/plugin-store
 */

import { mkdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { writeFileAtomic, withFileLock } from '@deepseek-ai/dsh-atomic-write'
import { TOKEN_MONITOR_SETTINGS_SCHEMA_VERSION } from '@deepseek-ai/dsh-token-monitor-contract'
import { PRICE_TABLE, type PricingTable } from './pricing.ts'
import { defaultBillingRules } from './billing.ts'
import { validateBillingRules, type BillingRules } from '@deepseek-ai/dsh-token-monitor-contract'
import {
  MAX_BALANCE_ENDPOINTS,
  validateBalanceEndpoints,
  validateBalanceProviders,
  validateBalanceScripts,
  type BalanceEndpoint,
  type BalanceProviderEntry,
  type BalanceScriptEntry,
} from './balance-storage.ts'

const STORE_FILE = 'state.json'

/** 插件自有状态；每次写入整体替换并自增 `revision`。 */
export interface TokenMonitorStoreDocument {
  revision: number
  schemaVersion: number
  legacyMigrationVersion?: number
  /** 内部定价覆盖；从不出现在公开设置接口里。 */
  priceTable: PricingTable
  billing?: BillingRules
  balanceScripts?: Record<string, BalanceScriptEntry>
  balanceProviders?: Record<string, BalanceProviderEntry>
  /** 每位供应商已批准的请求目标；缺省表示尚未批准任何目标。 */
  balanceEndpoints?: Record<string, BalanceEndpoint[]>
  /** 端点审批策略的一次性播种标记，值到达当前版本后不再重新播种。 */
  balanceEndpointPolicyVersion?: number
}

/** 校验后的状态，字段在读取时就已归一。 */
export type TokenMonitorStoreState = TokenMonitorStoreDocument

function fresh(): TokenMonitorStoreState {
  return { revision: 0, schemaVersion: TOKEN_MONITOR_SETTINGS_SCHEMA_VERSION, priceTable: PRICE_TABLE }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 归一并校验一份来自磁盘的状态；损坏或非法内容会阻止启动并保留原文件。 */
function normalize(raw: unknown): TokenMonitorStoreState {
  if (!isRecord(raw)) throw new TypeError('Invalid token monitor state')
  const state = fresh()
  if (Number.isSafeInteger(raw.revision) && (raw.revision as number) >= 0) state.revision = raw.revision as number
  if (raw.priceTable !== undefined) state.priceTable = parsePricingTable(raw.priceTable)
  if (raw.legacyMigrationVersion === 1) state.legacyMigrationVersion = 1
  if (raw.billing !== undefined) {
    state.billing = validateBillingRules(raw.billing)
  }
  if (raw.balanceScripts !== undefined) {
    validateBalanceScripts(raw.balanceScripts); state.balanceScripts = raw.balanceScripts
  }
  if (raw.balanceProviders !== undefined) {
    validateBalanceProviders(raw.balanceProviders); state.balanceProviders = raw.balanceProviders
  }
  if (raw.balanceEndpoints !== undefined) {
    validateBalanceEndpoints(raw.balanceEndpoints); state.balanceEndpoints = raw.balanceEndpoints
  }
  if (Number.isSafeInteger(raw.balanceEndpointPolicyVersion) && (raw.balanceEndpointPolicyVersion as number) >= 0) {
    state.balanceEndpointPolicyVersion = raw.balanceEndpointPolicyVersion as number
  }
  return state
}

/** 用调用方给出的段落覆盖当前状态，数组整段替换（与 settings 的合并语义一致）。 */
function merge(current: TokenMonitorStoreState, patch: Partial<TokenMonitorStoreDocument>): TokenMonitorStoreState {
  const next: TokenMonitorStoreState = { ...current }
  for (const key of ['billing', 'balanceScripts', 'balanceProviders', 'balanceEndpoints', 'balanceEndpointPolicyVersion'] as const) {
    if (Object.hasOwn(patch, key) && patch[key] === undefined) delete next[key]
  }
  if (patch.legacyMigrationVersion !== undefined) next.legacyMigrationVersion = patch.legacyMigrationVersion
  if (patch.priceTable !== undefined) next.priceTable = patch.priceTable
  if (patch.billing !== undefined) next.billing = patch.billing
  if (patch.balanceScripts !== undefined) {
    next.balanceScripts = mergeProviderMap(current.balanceScripts, patch.balanceScripts)
  }
  if (patch.balanceProviders !== undefined) {
    next.balanceProviders = mergeProviderMap(current.balanceProviders, patch.balanceProviders)
  }
  if (patch.balanceEndpoints !== undefined) {
    next.balanceEndpoints = mergeProviderMap(current.balanceEndpoints, patch.balanceEndpoints)
  }
  if (patch.balanceEndpointPolicyVersion !== undefined) {
    next.balanceEndpointPolicyVersion = patch.balanceEndpointPolicyVersion
  }
  return next
}

function mergeProviderMap<T>(current: Record<string, T> | undefined, patch: Record<string, T>): Record<string, T> {
  return { ...(current ?? {}), ...patch }
}

/** 写入前的边界校验；与旧 settings 的 `validate` 保持一致。 */
function validate(state: TokenMonitorStoreState): void {
  validateBillingRules(state.billing ?? defaultBillingRules(state.priceTable))
  if (state.balanceScripts !== undefined) validateBalanceScripts(state.balanceScripts)
  if (state.balanceProviders !== undefined) validateBalanceProviders(state.balanceProviders)
  if (state.balanceEndpoints !== undefined) validateBalanceEndpoints(state.balanceEndpoints)
  for (const endpoints of Object.values(state.balanceEndpoints ?? {})) {
    if (endpoints.length > MAX_BALANCE_ENDPOINTS) throw new TypeError('Too many approved balance endpoints')
  }
  const version = state.balanceEndpointPolicyVersion
  if (version !== undefined && (!Number.isSafeInteger(version) || version < 0)) {
    throw new TypeError('balanceEndpointPolicyVersion must be a non-negative safe integer')
  }
  if (!Number.isSafeInteger(state.revision) || state.revision < 0) throw new TypeError('revision must be a non-negative safe integer')
}

/** 同一进程内并发写同一文件的冲突。 */
export class PluginStoreConflictError extends Error {
  constructor(readonly expected: number, readonly actual: number) {
    super('Plugin state revision conflict')
  }
}

/**
 * 插件自有 JSON 状态。读取仅在内存里做；每次写入先落临时文件再原子替换，
 * 并用同目录锁串行化，避免两个窗口同时编辑脚本时互相覆盖。
 */
export class TokenMonitorStore {
  private state: TokenMonitorStoreState = fresh()
  private loaded = false
  private queue: Promise<unknown> = Promise.resolve()
  private readonly listeners = new Set<() => void>()
  private readonly path: string

  /** 一次性载入磁盘状态；缺失使用默认值，损坏内容直接抛错。 */
  async load(): Promise<void> {
    if (this.loaded) return
    // 同目录锁与原子替换都要求父目录存在；首次运行由这里建。
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 })
    this.state = await this.readDisk()
    this.loaded = true
  }

  private async readDisk(): Promise<TokenMonitorStoreState> {
    let text: string
    try { text = await readFile(this.path, 'utf8') }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return fresh(); throw error }
    const state = normalize(JSON.parse(text))
    validate(state)
    return state
  }

  constructor(dataDir: string) {
    this.path = join(dataDir, STORE_FILE)
  }

  /** 当前内存快照；写入方拿到的对象不会随后续写入变化。 */
  get(): TokenMonitorStoreState {
    return this.state
  }

  get revision(): number {
    return this.state.revision
  }

  /** 订阅每次成功提交；返回退订函数。 */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  private notify(): void {
    for (const listener of this.listeners) {
      try { listener() } catch { /* 订阅方异常不影响提交结果 */ }
    }
  }

  /** 在当前值之上合并一次并提交；`expectedRevision` 不匹配时抛冲突。
   * @param patch 要覆盖的段落，只允许插件自有字段。
   * @param expectedRevision 调用方最后观察到的版本号；缺省表示不检查。
   * @returns 提交后的完整状态。
   */
  async update(patch: Partial<TokenMonitorStoreDocument>, expectedRevision?: number): Promise<TokenMonitorStoreState> {
    return await this.serialize(async () => {
      await this.load()
      const current = this.state
      if (expectedRevision !== undefined && current.revision !== expectedRevision) {
        throw new PluginStoreConflictError(expectedRevision, current.revision)
      }
      const next = merge(current, patch)
      next.schemaVersion = TOKEN_MONITOR_SETTINGS_SCHEMA_VERSION
      next.revision = current.revision + 1
      validate(next)
      await withFileLock(this.path, async () => {
        // 锁内重读一次，覆盖另一个进程已提交的版本。
        this.state = await this.readDisk()
        if (expectedRevision !== undefined && this.state.revision !== expectedRevision) {
          throw new PluginStoreConflictError(expectedRevision, this.state.revision)
        }
        const committed = merge(this.state, patch)
        committed.schemaVersion = TOKEN_MONITOR_SETTINGS_SCHEMA_VERSION
        committed.revision = this.state.revision + 1
        validate(committed)
        await writeFileAtomic(this.path, JSON.stringify(committed, null, 2) + '\n', { mode: 0o600, dirMode: 0o700 })
        this.state = committed
        this.notify()
      })
      return this.state
    })
  }

  /** 清空插件自有状态并写回默认值，保留 `revision` 单调递增。 */
  async reset(): Promise<TokenMonitorStoreState> {
    return await this.serialize(async () => {
      await this.load()
      await withFileLock(this.path, async () => {
        const current = await this.readDisk()
        const next = fresh()
        next.revision = current.revision + 1
        if (current.legacyMigrationVersion !== undefined) next.legacyMigrationVersion = current.legacyMigrationVersion
        await writeFileAtomic(this.path, JSON.stringify(next, null, 2) + '\n', { mode: 0o600, dirMode: 0o700 })
        this.state = next
        this.notify()
      })
      return this.state
    })
  }

  private serialize<T>(action: () => Promise<T>): Promise<T> {
    const next = this.queue.then(action, action)
    this.queue = next.then(() => undefined, () => undefined)
    return next
  }
}

/** Validate a persisted price override before it reaches the billing engine. */
function parsePricingTable(value: unknown): PricingTable {
  if (!isRecord(value) || typeof value.version !== 'string' || !isRecord(value.models) || !Array.isArray(value.peakHours)) throw new TypeError('Invalid price table')
  const rate = (raw: unknown) => {
    if (!isRecord(raw) || !['input', 'cacheHit', 'output'].every(key => typeof raw[key] === 'number' && Number.isFinite(raw[key]) && raw[key] >= 0)) throw new TypeError('Invalid price rate')
    return { input: Number(raw.input), cacheHit: Number(raw.cacheHit), output: Number(raw.output) }
  }
  const models: PricingTable['models'] = {}
  for (const [id, model] of Object.entries(value.models)) {
    if (!isRecord(model)) throw new TypeError('Invalid model price')
    Object.defineProperty(models, id, { value: { peak: rate(model.peak), offPeak: rate(model.offPeak) }, enumerable: true })
  }
  const peakHours: PricingTable['peakHours'] = value.peakHours.map(pair => {
    if (!Array.isArray(pair) || pair.length !== 2 || !pair.every(hour => typeof hour === 'number' && Number.isFinite(hour) && hour >= 0 && hour <= 24)) throw new TypeError('Invalid peak hours')
    return [pair[0], pair[1]]
  })
  return { version: value.version, models, peakHours }
}
