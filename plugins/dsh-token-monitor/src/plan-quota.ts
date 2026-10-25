/**
 * Built-in plan-quota adapters and their shared query registry.
 *
 * A plan quota is a subscription allowance (a five-hour rolling window and a
 * weekly allowance) instead of a prepaid balance. The Host asks the provider's
 * own quota endpoint through the credential-bearing transport and publishes the
 * normalized result to the Client; the Client only renders it.
 *
 * The adapters here are keyless and shipped by the Host: they name one
 * relative request target and are approved by construction, so a configured
 * provider works without the user's balance-script mechanism. Nothing about
 * the provider endpoint, the credential or the upstream payload reaches the
 * client or the log.
 * @module dsh-token-monitor/plan-quota
 */

import type { Context } from '@deepseek-ai/cordis'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type { PlanQuotaProvider, PlanQuotaSnapshot, PlanQuotaWindow, PlanQuotaWindowKind } from '@deepseek-ai/dsh-token-monitor-contract'
import type { BalanceRequest } from './balance-script.ts'
import type { BalanceIdentity } from './balance-registry.ts'
import { BalanceHttpError } from './balance-network.ts'
import { createRouteGuard } from './http-trust.ts'

/** Aggregated plan quota endpoint. */
export const TOKEN_MONITOR_PLAN_QUOTAS_PATH = '/api/token-monitor/plan-quotas'

/** One query per provider is served from cache for this long. */
const PLAN_QUOTA_THROTTLE_MS = 15_000

/** How long a provider without a usable subscription stays out of the snapshot. */
const PLAN_QUOTA_ABSENT_TTL_MS = 30 * 60_000

/** Statuses that mean "this credential has no plan access" rather than a transient failure. */
const PLAN_QUOTA_ABSENT_STATUSES: readonly number[] = Object.freeze([401, 403, 404])

/** Normalized result of one adapter parse. */
export interface PlanQuotaParse {
  /** Subscription level reported by the provider, for example `pro`. */
  plan?: string
  /** Allowance windows; empty when the response carried none. */
  windows: PlanQuotaWindow[]
}

/** One built-in plan adapter bound to the gateway domain that serves it. */
export interface PlanQuotaAdapter {
  /** Registrable domain of the provider endpoint, matched on a label boundary. */
  domain: string
  /** Human readable provider name shown in the client. */
  label: string
  /** The single relative request target this adapter queries. */
  path: string
  /** Parse one provider response into plan level and allowance windows. */
  parse(raw: unknown): PlanQuotaParse
}

/** Read one plain object field, ignoring arrays and primitives. */
function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

/** Read one numeric field, accepting the decimal strings some providers use. */
function finiteNumber(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed === '') return undefined
    const parsed = Number(trimmed)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}

/** Read one refresh timestamp, accepting epoch milliseconds or an ISO date. */
function epochMs(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? value : undefined
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Date.parse(value.trim())
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}

/** Round a used share to two decimals and keep it inside the 0..100 range. */
function percent(value: number): number {
  return Math.min(Math.max(Math.round(value * 100) / 100, 0), 100)
}

/** Read one subscription level, ignoring empty or non-string values. */
function planLevel(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

/** Window label of one allowance kind. */
const WINDOW_LABELS: Readonly<Record<PlanQuotaWindowKind, string>> = Object.freeze({
  '5h': '5 小时',
  week: '每周',
  month: '每月',
  other: '其他额度',
})

/** Display order of the allowance kinds, matching the client's fixed order. */
const WINDOW_ORDER: Readonly<Record<PlanQuotaWindowKind, number>> = Object.freeze({ '5h': 0, week: 1, month: 2, other: 3 })

/**
 * GLM / 智谱 Coding Plan allowance units.
 *
 * The quota endpoint reports one entry per rolling window; the unit decides
 * which cycle the entry belongs to. Every other unit stays an `other` window
 * instead of being dropped, so an unknown cycle is still visible.
 */
const GLM_UNIT_KINDS: Readonly<Record<number, PlanQuotaWindowKind>> = Object.freeze({
  3: '5h',
  6: 'week',
  5: 'month',
})

/**
 * Parse a GLM / 智谱 Coding Plan quota payload.
 *
 * The payload carries one entry per window with the used share and the next
 * refresh time; the absolute allowance is not published, so `used` and `total`
 * stay null. A malformed entry is skipped instead of failing the whole parse.
 *
 * 同一周期可能出现多条记录（实测同时存在 `TOKENS_LIMIT` 与 `CREDIT_LIMIT`
 * 两类条目，分别对应 Token 口径与积分口径）。每个周期只保留一条：优先取带
 * 绝对用量（`usage` / `currentValue`）的积分条目，否则取第一条，避免同一
 * 刷新周期在界面上重复出现。
 * @param raw Provider response body.
 * @returns Plan level and allowance windows.
 */
function parseGlmQuota(raw: unknown): PlanQuotaParse {
  const data = record(record(raw)?.data)
  const windows: PlanQuotaWindow[] = []
  const limits = data?.limits
  if (Array.isArray(limits)) {
    const picked = new Map<number, PlanQuotaWindow>()
    for (const item of limits) {
      const entry = record(item)
      if (entry === undefined) continue
      const unit = finiteNumber(entry.unit)
      if (unit === undefined) continue
      const share = finiteNumber(entry.percentage)
      const resetAt = epochMs(entry.nextResetTime)
      const used = finiteNumber(entry.currentValue)
      const total = finiteNumber(entry.usage)
      if (share === undefined && resetAt === undefined && used === undefined && total === undefined) continue
      const kind = GLM_UNIT_KINDS[unit] ?? 'other'
      const window: PlanQuotaWindow = {
        kind,
        label: WINDOW_LABELS[kind],
        // 百分比缺失时由绝对用量折算，两个口径都没有才保持 null。
        usedPercent: share === undefined && total !== undefined && total > 0 && used !== undefined
          ? percent(used / total * 100)
          : share === undefined ? null : percent(share),
        used: used ?? null,
        total: total ?? null,
        ...(resetAt === undefined ? {} : { resetAt }),
      }
      const existing = picked.get(unit)
      // 每个周期只保留一条：已选条目没有绝对用量而新条目有，或尚无条目时替换。
      if (existing === undefined
        || (existing.used === null && existing.total === null && (window.used !== null || window.total !== null))) {
        picked.set(unit, window)
      }
    }
    windows.push(...[...picked.entries()]
      .map(([, window]) => window)
      .sort((left, right) => WINDOW_ORDER[left.kind] - WINDOW_ORDER[right.kind]))
  }
  const plan = planLevel(data?.level)
  return { ...(plan === undefined ? {} : { plan }), windows }
}

/**
 * Build one Kimi Coding Plan window from its allowance detail.
 *
 * Kimi publishes its figures as decimal strings and its refresh time as an
 * ISO date, so every figure is converted here.
 * @param detail Allowance detail of one window.
 * @param kind Refresh cycle of this window.
 * @returns The window, or undefined when the detail carries no usable figure.
 */
function kimiWindow(detail: Record<string, unknown> | undefined, kind: PlanQuotaWindowKind): PlanQuotaWindow | undefined {
  if (detail === undefined) return undefined
  const total = finiteNumber(detail.limit)
  const remaining = finiteNumber(detail.remaining)
  const used = finiteNumber(detail.used) ?? (total !== undefined && remaining !== undefined
    ? Math.max(total - remaining, 0)
    : undefined)
  const resetAt = epochMs(detail.resetTime)
  if (total === undefined && used === undefined && resetAt === undefined) return undefined
  const share = total !== undefined && total > 0 && used !== undefined ? percent((used / total) * 100) : null
  return {
    kind,
    label: WINDOW_LABELS[kind],
    usedPercent: share,
    used: used ?? null,
    total: total ?? null,
    ...(resetAt === undefined ? {} : { resetAt }),
  }
}

/**
 * Parse a Kimi Coding Plan usage payload.
 *
 * The five-hour window is the entry whose window is 300 minutes long; the
 * weekly allowance is the top-level usage summary. Other entries are ignored
 * so the same cycle is never published twice.
 * @param raw Provider response body.
 * @returns Plan level and allowance windows.
 */
function parseKimiQuota(raw: unknown): PlanQuotaParse {
  const root = record(raw)
  const windows: PlanQuotaWindow[] = []
  const limits = root?.limits
  if (Array.isArray(limits)) {
    for (const item of limits) {
      const entry = record(item)
      const window = record(entry?.window)
      if (window === undefined || window.timeUnit !== 'TIME_UNIT_MINUTE') continue
      if (finiteNumber(window.duration) !== 300) continue
      const window5h = kimiWindow(record(entry?.detail), '5h')
      if (window5h !== undefined) windows.push(window5h)
    }
  }
  const week = kimiWindow(record(root?.usage), 'week')
  if (week !== undefined) windows.push(week)
  const plan = planLevel(record(record(root?.user)?.membership)?.level)
  return { ...(plan === undefined ? {} : { plan }), windows }
}

/** 保险起见的毫秒时间戳下界（2001-09-09），避免把秒/纳秒误当毫秒。 */
const MIN_EPOCH_MS = 1_000_000_000_000

/**
 * Read one MiniMax epoch field, accepting only plausible millisecond values.
 * @param value Raw field value.
 * @returns Epoch milliseconds, or undefined when absent or out of range.
 */
function miniMaxEpoch(value: unknown): number | undefined {
  const parsed = finiteNumber(value)
  return parsed !== undefined && parsed >= MIN_EPOCH_MS ? parsed : undefined
}

/**
 * Aggregate one MiniMax window kind across models, keeping the tightest entry.
 *
 * `/v1/token_plan/remains` 按模型逐条返回 5 小时与周窗口。套餐卡片是供应商级的，
 * 因此每个周期取「已用比例最高」的那条模型记录（最紧的窗口），刷新时间取同一条
 * 记录自己的时间字段。`status === 3` 表示该模型不在套餐内，不参与该周期的聚合。
 * @param entries Parsed model entries of the payload.
 * @param kind Which allowance cycle to aggregate.
 * @param fields Field names of the requested cycle; `remainingMs` names this
 *   cycle's own remaining-duration field and must be omitted when the API only
 *   publishes one for another cycle.
 * @param at Snapshot clock used when only a remaining duration is available.
 * @returns The aggregated window, or undefined when no model reports this cycle.
 */
function miniMaxWindow(
  entries: Record<string, unknown>[],
  kind: PlanQuotaWindowKind,
  fields: { used: string; total: string; reportedPercent: string; status: string; resetAt: string; remainingMs?: string },
  at: number,
): PlanQuotaWindow | undefined {
  let best: { percent: number | null; window: PlanQuotaWindow } | undefined
  for (const entry of entries) {
    if (finiteNumber(entry[fields.status]) === 3) continue
    const total = finiteNumber(entry[fields.total])
    const used = finiteNumber(entry[fields.used])
    const reportedPercent = finiteNumber(entry[fields.reportedPercent])
    // 实测口径：`*_remaining_percent` 是「剩余百分比」（用户用满时接口给 0，
    // 官方 mmx 的 mg() 把它直接当已用渲染属于其缺陷，ki() 则两种口径都做了
    // 歧义消除）。已用 = 100 − 剩余；字段缺失时才用 usage/total 折算，
    // 且 total<=0 视为无数据（不产出 0/0 的假读数）。
    const share = reportedPercent !== undefined
      ? percent(100 - reportedPercent)
      : total !== undefined && total > 0 && used !== undefined ? percent(used / total * 100) : null
    // 只允许用本周期自己的剩余时长折算刷新时间：`remains_time` 只描述 5 小时
    // 窗口，周窗口绝不借用（否则会把周刷新时间错报成「还剩 5 小时窗口的时长」）。
    const remainingMs = fields.remainingMs === undefined ? undefined : finiteNumber(entry[fields.remainingMs])
    const resetAt = miniMaxEpoch(entry[fields.resetAt])
      ?? (remainingMs !== undefined && remainingMs > 0 ? at + remainingMs : undefined)
    if (share === null && resetAt === undefined) continue
    const usableCounts = total !== undefined && total > 0 && used !== undefined && used >= 0 && used <= total
    const window: PlanQuotaWindow = {
      kind,
      label: WINDOW_LABELS[kind],
      usedPercent: share,
      used: usableCounts ? used : null,
      total: usableCounts ? total : null,
      ...(resetAt === undefined ? {} : { resetAt }),
    }
    if (best === undefined || (share !== null && (best.percent === null || share > best.percent))) best = { percent: share, window }
  }
  return best?.window
}

/**
 * Parse a MiniMax M Plan usage payload.
 *
 * @param raw Provider response body.
 * @returns The tightest 5-hour and weekly windows across models.
 */
function parseMiniMaxQuota(raw: unknown): PlanQuotaParse {
  const root = record(raw)
  const list = root?.model_remains
  if (!Array.isArray(list)) return { windows: [] }
  const at = Date.now()
  const entries = list.flatMap(item => {
    const entry = record(item)
    return entry === undefined ? [] : [entry]
  })
  const windows: PlanQuotaWindow[] = []
  const cycles: readonly [PlanQuotaWindowKind, { used: string; total: string; reportedPercent: string; status: string; resetAt: string; remainingMs?: string }][] = [
    ['5h', { used: 'current_interval_usage_count', total: 'current_interval_total_count', reportedPercent: 'current_interval_remaining_percent', status: 'current_interval_status', resetAt: 'end_time', remainingMs: 'remains_time' }],
    // 周窗口没有自己的剩余时长字段：`remains_time` 只属于 5 小时窗口，
    // 不传 remainingMs，weekly_end_time 缺失时刷新时间保持未记录。
    ['week', { used: 'current_weekly_usage_count', total: 'current_weekly_total_count', reportedPercent: 'current_weekly_remaining_percent', status: 'current_weekly_status', resetAt: 'weekly_end_time' }],
  ]
  for (const [kind, fields] of cycles) {
    const window = miniMaxWindow(entries, kind, fields, at)
    if (window !== undefined) windows.push(window)
  }
  return { windows }
}


/** Plan adapters the Host ships and approves itself. */
export const PLAN_QUOTA_ADAPTERS: readonly PlanQuotaAdapter[] = Object.freeze([
  Object.freeze({
    domain: 'z.ai',
    label: 'GLM Coding Plan',
    path: '/api/monitor/usage/quota/limit',
    parse: parseGlmQuota,
  }),
  Object.freeze({
    domain: 'bigmodel.cn',
    label: 'GLM Coding Plan',
    path: '/api/monitor/usage/quota/limit',
    parse: parseGlmQuota,
  }),
  Object.freeze({
    domain: 'kimi.com',
    label: 'Kimi Coding Plan',
    path: '/coding/v1/usages',
    parse: parseKimiQuota,
  }),
  Object.freeze({
    domain: 'minimax.io',
    label: 'MiniMax M Plan',
    path: '/v1/token_plan/remains',
    parse: parseMiniMaxQuota,
  }),
  Object.freeze({
    domain: 'minimax.cn',
    label: 'MiniMax M Plan',
    path: '/v1/token_plan/remains',
    parse: parseMiniMaxQuota,
  }),
  Object.freeze({
    domain: 'minimaxi.com',
    label: 'MiniMax M Plan',
    path: '/v1/token_plan/remains',
    parse: parseMiniMaxQuota,
  }),
])

/** Whether one endpoint hostname belongs to a gateway domain on a label boundary. */
function matchesDomain(hostname: string, domain: string): boolean {
  return hostname === domain || hostname.endsWith('.' + domain)
}

/**
 * Pick the built-in plan adapter for one configured provider endpoint.
 * @param baseURL Provider endpoint exactly as configured; other hosts match nothing.
 * @returns The adapter serving that host, or undefined for an unknown gateway.
 */
export function planQuotaAdapterFor(baseURL: string): PlanQuotaAdapter | undefined {
  let hostname: string
  try {
    hostname = new URL(baseURL).hostname.toLowerCase()
  } catch {
    return undefined
  }
  return PLAN_QUOTA_ADAPTERS.find(adapter => matchesDomain(hostname, adapter.domain))
}

/** Dependencies of the plan quota registry. */
interface PlanQuotaDependencies {
  /** Configured provider identifiers to inspect. */
  listProviders(): readonly string[]
  /** Resolve the current credential and endpoint of one provider. */
  resolveIdentity(provider: string): Promise<BalanceIdentity | undefined>
  /** Perform one credential-bearing request against the provider endpoint. */
  request(descriptor: BalanceRequest, baseURL: string, apiKey: string, signal: AbortSignal): Promise<unknown>
  /** Clock override for tests. */
  now?: () => number
  /** Optional fixed-message diagnostic sink; receives no provider content. */
  warn?: (message: string) => void
}

/** Cached state of one provider. */
interface PlanQuotaEntry {
  identity: BalanceIdentity
  adapter: PlanQuotaAdapter
  controller: AbortController
  pending?: Promise<PlanQuotaProvider | undefined>
  value?: PlanQuotaProvider
  nextAttempt: number
  /** Set when the provider answered that this credential has no plan access. */
  absent?: true
}

/**
 * Demand-driven plan quota cache.
 *
 * Every configured provider is queried at most once at a time: concurrent
 * reads share the in-flight request, a fresh result is reused for the
 * throttle interval, and a credential change drops the cached value instead of
 * serving a result of an older credential.
 */
export class PlanQuotaRegistry {
  private entries = new Map<string, PlanQuotaEntry>()
  private pendingRequests = new Set<Promise<PlanQuotaProvider | undefined>>()
  private stopped = false

  constructor(private dependencies: PlanQuotaDependencies) {}

  /**
   * Query every configured provider that exposes plan quotas.
   * @returns Snapshot ordered by provider identifier.
   */
  async snapshot(): Promise<PlanQuotaSnapshot> {
    const providers = [...new Set(this.dependencies.listProviders())].sort()
    const results = await Promise.all(providers.map(async provider => {
      try { return await this.get(provider) }
      catch { return undefined }
    }))
    const entries: PlanQuotaProvider[] = []
    for (const result of results) if (result !== undefined) entries.push(result)
    return { updatedAt: this.now(), providers: entries }
  }

  /**
   * Read one provider's plan quota.
   * @param provider Exact configured provider identifier.
   * @returns The provider entry, or undefined when the provider has no
   * credential, no known gateway or no usable answer.
   */
  async get(provider: string): Promise<PlanQuotaProvider | undefined> {
    if (this.stopped) return undefined
    const identity = await this.dependencies.resolveIdentity(provider)
    if (this.stopped) return undefined
    // 没有凭据或没有已知网关的 provider 不进入快照。
    if (identity === undefined) { this.invalidate(provider); return undefined }
    const adapter = planQuotaAdapterFor(identity.baseURL)
    if (adapter === undefined) { this.invalidate(provider); return undefined }
    let entry = this.entries.get(provider)
    if (entry !== undefined && (entry.identity.apiKey !== identity.apiKey || entry.identity.baseURL !== identity.baseURL)) {
      this.invalidate(provider)
      entry = undefined
    }
    if (entry === undefined) {
      entry = { identity, adapter, controller: new AbortController(), nextAttempt: 0 }
      this.entries.set(provider, entry)
    }
    if (entry.pending !== undefined) return entry.pending
    if (this.now() < entry.nextAttempt) return entry.value
    const current = entry
    const pending = this.run(current, provider, identity)
    current.pending = pending
    this.pendingRequests.add(pending)
    const release = (): void => {
      if (current.pending === pending) delete current.pending
      this.pendingRequests.delete(pending)
    }
    void pending.then(release, release)
    return pending
  }

  /**
   * Run one provider query and publish its result.
   * @param entry Cached state of the queried provider.
   * @param provider Exact configured provider identifier.
   * @param identity Credential and endpoint the query started with.
   * @returns The provider entry, or undefined when the answer was discarded.
   */
  private async run(entry: PlanQuotaEntry, provider: string, identity: BalanceIdentity): Promise<PlanQuotaProvider | undefined> {
    const controller = entry.controller
    try {
      const raw = await this.dependencies.request(
        { path: entry.adapter.path, method: 'GET', auth: 'bearer' },
        identity.baseURL, identity.apiKey, controller.signal)
      const parsed = entry.adapter.parse(raw)
      const latest = await this.dependencies.resolveIdentity(provider)
      if (this.stopped || controller.signal.aborted || this.entries.get(provider) !== entry) return undefined
      // 凭据在查询期间变化时丢弃旧结果，下一次读取重新查询。
      if (latest === undefined || latest.apiKey !== identity.apiKey || latest.baseURL !== identity.baseURL) {
        this.invalidate(provider)
        return undefined
      }
      // 网关认得这家厂商，但响应里没有任何额度窗口：这条凭据没有开通套餐，
      // 不是查询失败。不进入快照，并在一段时间内不再重复请求。
      if (parsed.windows.length === 0) {
        delete entry.value
        entry.absent = true
        entry.nextAttempt = this.now() + PLAN_QUOTA_ABSENT_TTL_MS
        return undefined
      }
      const value: PlanQuotaProvider = {
        provider,
        label: entry.adapter.label,
        ...(parsed.plan === undefined ? {} : { plan: parsed.plan }),
        windows: parsed.windows,
        updatedAt: this.now(),
        status: 'ok',
      }
      entry.value = value
      delete entry.absent
      entry.nextAttempt = this.now() + PLAN_QUOTA_THROTTLE_MS
      return value
    } catch (error) {
      // 上游异常细节、主机名、路径与凭据都不进入日志或响应。
      if (this.stopped || controller.signal.aborted || this.entries.get(provider) !== entry) return undefined
      // 401/403/404 表示这条凭据对套餐接口没有访问权，按「未接入」处理。
      if (error instanceof BalanceHttpError && PLAN_QUOTA_ABSENT_STATUSES.includes(error.status)) {
        delete entry.value
        entry.absent = true
        entry.nextAttempt = this.now() + PLAN_QUOTA_ABSENT_TTL_MS
        return undefined
      }
      const value: PlanQuotaProvider = {
        provider,
        label: entry.adapter.label,
        windows: [],
        updatedAt: this.now(),
        status: 'error',
      }
      entry.value = value
      entry.nextAttempt = this.now() + PLAN_QUOTA_THROTTLE_MS
      this.dependencies.warn?.('dsh-token-monitor: plan quota query failed')
      return value
    }
  }

  /**
   * Drop one provider's cached value and cancel its obsolete request.
   * @param provider Exact provider identifier.
   */
  invalidate(provider: string): void {
    this.entries.get(provider)?.controller.abort()
    this.entries.delete(provider)
  }

  /** Cancel all work when the owning plugin context is disposed. */
  async stop(): Promise<void> {
    this.stopped = true
    for (const provider of [...this.entries.keys()]) this.invalidate(provider)
    await Promise.allSettled([...this.pendingRequests])
  }

  /** Current clock reading in epoch milliseconds. */
  private now(): number {
    return (this.dependencies.now ?? Date.now)()
  }
}

/** Write one JSON response with the shared no-store headers. */
function send(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(value))
}

/**
 * Build the aggregated plan quota handler.
 * @param registry Shared plan quota cache.
 * @returns The request handler of the endpoint.
 */
export function createPlanQuotaHandler(registry: PlanQuotaRegistry): (request: IncomingMessage, response: ServerResponse) => Promise<void> {
  return async (request, response) => {
    if (request.method !== 'GET') { send(response, 405, { error: { code: 'METHOD_NOT_ALLOWED' } }); return }
    try { send(response, 200, await registry.snapshot()) }
    catch { send(response, 200, { updatedAt: Date.now(), providers: [] }) }
  }
}

/**
 * Register the aggregated plan quota endpoint on the owning context.
 * @param ctx Context with web server and connection service.
 * @param registry Shared plan quota cache.
 */
export function registerPlanQuotaApi(ctx: Context, registry: PlanQuotaRegistry): void {
  const guard = createRouteGuard(ctx)
  const handler = createPlanQuotaHandler(registry)
  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: TOKEN_MONITOR_PLAN_QUOTAS_PATH, handler: (request, response) => {
    if (!guard(request, response)) return
    return handler(request, response)
  } }), 'dsh-token-monitor: plan quota route')
}
