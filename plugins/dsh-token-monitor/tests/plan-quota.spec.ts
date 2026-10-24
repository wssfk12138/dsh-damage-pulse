import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { PlanQuotaSnapshot } from '@deepseek-ai/dsh-token-monitor-contract'
import {
  PlanQuotaRegistry,
  TOKEN_MONITOR_PLAN_QUOTAS_PATH,
  createPlanQuotaHandler,
  planQuotaAdapterFor,
  registerPlanQuotaApi,
} from '../src/plan-quota.ts'

const GLM_RAW = {
  code: 200,
  data: {
    limits: [
      { type: 'TOKENS_LIMIT', unit: 3, percentage: 42.5, nextResetTime: 1_700_000_000_000 },
      { type: 'TOKENS_LIMIT', unit: 6, percentage: 8, nextResetTime: 1_700_600_000_000 },
      { type: 'TOKENS_LIMIT', unit: 5, percentage: 100, nextResetTime: 1_702_000_000_000 },
    ],
    level: 'pro',
  },
}

const KIMI_RAW = {
  user: { membership: { level: 'max' } },
  usage: { limit: '2000', used: '500', remaining: '1500', resetTime: '2026-10-24T08:35:03Z' },
  limits: [
    { window: { duration: 300, timeUnit: 'TIME_UNIT_MINUTE' }, detail: { limit: '200', used: '50', remaining: '150', resetTime: '2026-10-23T20:00:00Z' } },
    { window: { duration: 60, timeUnit: 'TIME_UNIT_MINUTE' }, detail: { limit: '60', used: '10', remaining: '50', resetTime: '2026-10-23T21:00:00Z' } },
  ],
  parallel: { limit: 5 },
}

function glmAdapter() {
  const adapter = planQuotaAdapterFor('https://api.z.ai/api/coding/paas/v4')
  expect(adapter).toBeDefined()
  return adapter!
}

function kimiAdapter() {
  const adapter = planQuotaAdapterFor('https://api.kimi.com/coding/v1')
  expect(adapter).toBeDefined()
  return adapter!
}

const MINIMAX_RAW = {
  model_remains: [
    {
      model_name: 'MiniMax-M2',
      current_interval_usage_count: 30, current_interval_total_count: 100, current_interval_remaining_percent: 70, current_interval_status: 1,
      start_time: 1_700_000_000_000, end_time: 1_700_001_800_000, remains_time: 600_000,
      current_weekly_usage_count: 500, current_weekly_total_count: 10_000, current_weekly_remaining_percent: 95, current_weekly_status: 1,
      weekly_start_time: 1_699_900_000_000, weekly_end_time: 1_700_600_000_000, weekly_boost_permille: 0,
    },
    {
      model_name: 'MiniMax-VL',
      current_interval_usage_count: 80, current_interval_total_count: 100, current_interval_remaining_percent: 20, current_interval_status: 1,
      start_time: 1_700_000_000_000, end_time: 1_700_001_800_000, remains_time: 600_000,
      current_weekly_usage_count: 100, current_weekly_total_count: 10_000, current_weekly_remaining_percent: 99, current_weekly_status: 1,
      weekly_start_time: 1_699_900_000_000, weekly_end_time: 1_700_600_000_000, weekly_boost_permille: 0,
    },
    // 不在套餐内的模型不参与聚合。
    {
      model_name: 'video-01',
      current_interval_usage_count: 0, current_interval_total_count: 0, current_interval_remaining_percent: 0, current_interval_status: 3,
      current_weekly_usage_count: 0, current_weekly_total_count: 0, current_weekly_remaining_percent: 0, current_weekly_status: 3,
    },
  ],
}

function miniMaxAdapter() {
  const adapter = planQuotaAdapterFor('https://api.minimaxi.com/anthropic')
  expect(adapter).toBeDefined()
  return adapter!
}

function response() {
  return { status: 0, headers: {} as Record<string, string>, body: '', writeHead(status: number, headers: Record<string, string>) { this.status = status; this.headers = headers }, end(value?: string) { this.body = value ?? '' } }
}

describe('built-in plan quota adapters', () => {
  it('parses the GLM quota payload into 5-hour, weekly and monthly windows', () => {
    const parsed = glmAdapter().parse(GLM_RAW)
    expect(parsed.plan).toBe('pro')
    expect(parsed.windows).toEqual([
      { kind: '5h', label: '5 小时', usedPercent: 42.5, used: null, total: null, resetAt: 1_700_000_000_000 },
      { kind: 'week', label: '每周', usedPercent: 8, used: null, total: null, resetAt: 1_700_600_000_000 },
      { kind: 'month', label: '每月', usedPercent: 100, used: null, total: null, resetAt: 1_702_000_000_000 },
    ])
  })

  it('keeps unknown GLM units as other windows and skips malformed entries', () => {
    const parsed = glmAdapter().parse({ data: { limits: [
      { type: 'TOKENS_LIMIT', unit: 99, percentage: 10 },
      { type: 'TOKENS_LIMIT', unit: 3, percentage: 'x' },
      { type: 'TOKENS_LIMIT', unit: 3, percentage: 300 },
      null,
      'nonsense',
    ] } })
    expect(parsed.windows).toEqual([
      { kind: '5h', label: '5 小时', usedPercent: 100, used: null, total: null },
      { kind: 'other', label: '其他额度', usedPercent: 10, used: null, total: null },
    ])
    expect(parsed.plan).toBeUndefined()
  })

  it('never throws on a malformed GLM payload', () => {
    for (const raw of [null, undefined, 42, 'text', [], {}, { data: null }, { data: { limits: 'nope' } }, { data: { limits: [{}] } }]) {
      const parsed = glmAdapter().parse(raw)
      expect(parsed.windows, JSON.stringify(raw)).toEqual([])
      expect(parsed.plan, JSON.stringify(raw)).toBeUndefined()
    }
  })

  it('keeps one window per GLM cycle and prefers the entry with absolute usage', () => {
    // 实测同一周期会同时出现 TOKENS_LIMIT（仅百分比）与 CREDIT_LIMIT（含绝对用量）两类条目。
    const parsed = glmAdapter().parse({ data: { limits: [
      { type: 'TOKENS_LIMIT', unit: 3, percentage: 42.5, nextResetTime: 1_700_000_000_000 },
      { type: 'CREDIT_LIMIT', unit: 3, currentValue: 150, usage: 2000, nextResetTime: 1_700_000_500_000 },
      { type: 'CREDIT_LIMIT', unit: 6, currentValue: 30, usage: 100 },
    ] } })
    expect(parsed.windows).toEqual([
      // 同周期有绝对用量的积分条目胜出，百分比由 used/total 折算，刷新时间取胜出条目自己的。
      { kind: '5h', label: '5 小时', usedPercent: 7.5, used: 150, total: 2000, resetAt: 1_700_000_500_000 },
      { kind: 'week', label: '每周', usedPercent: 30, used: 30, total: 100 },
    ])
  })

  it('parses the Kimi usage payload into a 5-hour window and a weekly allowance', () => {
    const parsed = kimiAdapter().parse(KIMI_RAW)
    expect(parsed.plan).toBe('max')
    expect(parsed.windows).toEqual([
      { kind: '5h', label: '5 小时', usedPercent: 25, used: 50, total: 200, resetAt: Date.parse('2026-10-23T20:00:00Z') },
      { kind: 'week', label: '每周', usedPercent: 25, used: 500, total: 2000, resetAt: Date.parse('2026-10-24T08:35:03Z') },
    ])
  })

  it('never throws on a malformed Kimi payload', () => {
    for (const raw of [null, undefined, 42, [], {}, { usage: 'x' }, { limits: [{ window: { duration: 300 } }] }, { limits: [{ window: { duration: '300', timeUnit: 'TIME_UNIT_MINUTE' }, detail: {} }] }]) {
      const parsed = kimiAdapter().parse(raw)
      expect(parsed.windows, JSON.stringify(raw)).toEqual([])
      expect(parsed.plan, JSON.stringify(raw)).toBeUndefined()
    }
  })

  it('parses the MiniMax M Plan payload into the tightest 5-hour and weekly windows', () => {
    const parsed = miniMaxAdapter().parse(MINIMAX_RAW)
    expect(parsed.windows).toHaveLength(2)
    const [fiveHour, week] = parsed.windows
    // `*_remaining_percent` 是剩余百分比，已用 = 100 − 剩余（实测：用满时接口给 0）。
    // 5 小时窗口取最紧的模型（VL 剩 20 → 已用 80%），周窗口取最紧（VL 剩 99 → 已用 1%）。
    expect(fiveHour).toMatchObject({ kind: '5h', label: '5 小时', usedPercent: 80, used: 80, total: 100, resetAt: 1_700_001_800_000 })
    expect(week).toMatchObject({ kind: 'week', label: '每周', usedPercent: 5, used: 500, total: 10_000, resetAt: 1_700_600_000_000 })
    // 绝对时间戳字段缺失时，用剩余时长在解析时刻折算成刷新时间。
    // 时钟窗口必须紧贴这次解析，否则全量负载下 Date.now 漂移会让断言偶发失败。
    const before = Date.now()
    const fallback = miniMaxAdapter().parse({ model_remains: [
      { current_interval_usage_count: 1, current_interval_total_count: 2, current_interval_remaining_percent: 50, current_interval_status: 1, remains_time: 60_000 },
    ] })
    const after = Date.now()
    expect(fallback.windows[0]!.resetAt).toBeGreaterThanOrEqual(before + 60_000)
    expect(fallback.windows[0]!.resetAt).toBeLessThanOrEqual(after + 60_000)
    // total<=0 时不产出 0/0 假读数；已用 = 100 − 剩余。
    const zeroCounts = miniMaxAdapter().parse({ model_remains: [
      { current_interval_usage_count: 0, current_interval_total_count: 0, current_interval_remaining_percent: 2, current_interval_status: 1 },
    ] })
    expect(zeroCounts.windows[0]).toMatchObject({ usedPercent: 98, used: null, total: null })
    // 用满时接口给剩余 0 → 已用 100%。
    const exhausted = miniMaxAdapter().parse({ model_remains: [
      { current_interval_usage_count: 0, current_interval_total_count: 0, current_interval_remaining_percent: 0, current_interval_status: 1 },
    ] })
    expect(exhausted.windows[0]).toMatchObject({ usedPercent: 100, used: null, total: null })
    // 周窗口不借用 5 小时窗口的 remains_time：weekly_end_time 缺失时刷新时间保持未记录。
    const noWeeklyEnd = miniMaxAdapter().parse({ model_remains: [
      {
        current_interval_usage_count: 10, current_interval_total_count: 100, current_interval_remaining_percent: 90, current_interval_status: 1,
        remains_time: 60_000,
        current_weekly_usage_count: 10, current_weekly_total_count: 1000, current_weekly_remaining_percent: 99, current_weekly_status: 1,
      },
    ] })
    expect(noWeeklyEnd.windows).toHaveLength(2)
    expect(noWeeklyEnd.windows[1]).toMatchObject({ kind: 'week', usedPercent: 1, used: 10, total: 1000 })
    expect(noWeeklyEnd.windows[1]!.resetAt).toBeUndefined()
    // 百分比缺失且 total<=0 时该条目不产出窗口。
    expect(miniMaxAdapter().parse({ model_remains: [
      { current_interval_usage_count: 0, current_interval_total_count: 0, current_interval_status: 1 },
    ] }).windows).toEqual([])
    expect(() => miniMaxAdapter().parse(null)).not.toThrow()
    expect(() => miniMaxAdapter().parse({ model_remains: 'nope' })).not.toThrow()
    expect(miniMaxAdapter().parse({ model_remains: [{ current_interval_status: 3, current_weekly_status: 3 }] }).windows).toEqual([])
  })

  it('picks the adapter by hostname and refuses an unknown gateway', () => {
    expect(planQuotaAdapterFor('https://api.z.ai/api/coding/paas/v4')).toMatchObject({ label: 'GLM Coding Plan', path: '/api/monitor/usage/quota/limit' })
    expect(planQuotaAdapterFor('https://open.bigmodel.cn/api/coding/paas/v4')).toMatchObject({ label: 'GLM Coding Plan' })
    expect(planQuotaAdapterFor('https://api.kimi.com/coding/v1')).toMatchObject({ label: 'Kimi Coding Plan', path: '/coding/v1/usages' })
    expect(planQuotaAdapterFor('https://api.kimi.com')).toMatchObject({ label: 'Kimi Coding Plan' })
    expect(planQuotaAdapterFor('https://api.minimaxi.com/anthropic')).toMatchObject({ label: 'MiniMax M Plan', path: '/v1/token_plan/remains' })
    expect(planQuotaAdapterFor('https://api.minimax.io')).toMatchObject({ label: 'MiniMax M Plan' })
    expect(planQuotaAdapterFor('https://relay.example/v1')).toBeUndefined()
    expect(planQuotaAdapterFor('https://z.ai.evil.example')).toBeUndefined()
    expect(planQuotaAdapterFor('https://notkimi.com')).toBeUndefined()
    expect(planQuotaAdapterFor('not a url')).toBeUndefined()
  })
})

describe('plan quota registry', () => {
  function setup() {
    const identities: Record<string, { apiKey: string; baseURL: string } | undefined> = {
      'zai-coding': { apiKey: 'key-a', baseURL: 'https://api.z.ai/api/coding/paas/v4' },
      'kimi-coding': { apiKey: 'key-a', baseURL: 'https://api.kimi.com/coding/v1' },
      'relay-provider': { apiKey: 'key-a', baseURL: 'https://relay.example/v1' },
      'deepseek-official': { apiKey: 'key-a', baseURL: 'https://api.deepseek.com' },
    }
    const request = vi.fn(async (_descriptor: unknown, baseURL: string) => (baseURL.includes('kimi.com') ? KIMI_RAW : GLM_RAW))
    const registry = new PlanQuotaRegistry({
      listProviders: () => Object.keys(identities),
      resolveIdentity: async provider => identities[provider],
      request: request as never,
    })
    return { registry, request }
  }

  it('publishes only providers with a known gateway and keeps the contract shape', async () => {
    const { registry, request } = setup()
    const snapshot = await registry.snapshot()
    expect(snapshot.updatedAt).toBeTypeOf('number')
    expect(snapshot.providers.map(item => item.provider)).toEqual(['kimi-coding', 'zai-coding'])
    expect(snapshot.providers[0]).toMatchObject({ provider: 'kimi-coding', label: 'Kimi Coding Plan', plan: 'max', status: 'ok' })
    expect(snapshot.providers[1]).toMatchObject({ provider: 'zai-coding', label: 'GLM Coding Plan', plan: 'pro', status: 'ok' })
    expect(snapshot.providers[1]!.windows[0]).toMatchObject({ kind: '5h', usedPercent: 42.5 })
    expect(request).toHaveBeenCalledTimes(2)
    await registry.stop()
  })

  it('coalesces concurrent queries and throttles a fresh result', async () => {
    const { registry, request } = setup()
    const [a, b] = await Promise.all([registry.snapshot(), registry.snapshot()])
    expect(a.providers.length).toBe(2)
    expect(b.providers.length).toBe(2)
    expect(request).toHaveBeenCalledTimes(2)
    const third = await registry.snapshot()
    expect(third.providers.length).toBe(2)
    expect(request).toHaveBeenCalledTimes(2)
    await registry.stop()
  })

  it('marks a failing provider as error without leaking provider details', async () => {
    const warn = vi.fn()
    const request = vi.fn(async () => { throw new Error('https://api.z.ai/api/monitor/usage/quota/limit rejected key-a') })
    const registry = new PlanQuotaRegistry({
      listProviders: () => ['zai-coding'],
      resolveIdentity: async () => ({ apiKey: 'key-a', baseURL: 'https://api.z.ai/api/coding/paas/v4' }),
      request: request as never,
      warn,
    })
    const snapshot = await registry.snapshot()
    expect(snapshot.providers).toEqual([{ provider: 'zai-coding', label: 'GLM Coding Plan', windows: [], updatedAt: expect.any(Number), status: 'error' }])
    const body = JSON.stringify(snapshot)
    expect(body).not.toContain('api.z.ai')
    expect(body).not.toContain('/api/monitor')
    expect(body).not.toContain('key-a')
    expect(JSON.stringify(warn.mock.calls)).not.toContain('api.z.ai')
    expect(warn).toHaveBeenCalledWith('dsh-token-monitor: plan quota query failed')
    await registry.stop()
  })

  it('drops a result whose credential changed during the query', async () => {
    const identities: Record<string, { apiKey: string; baseURL: string }> = {
      'zai-coding': { apiKey: 'key-a', baseURL: 'https://api.z.ai/api/coding/paas/v4' },
    }
    const request = vi.fn(async () => { identities['zai-coding'] = { apiKey: 'key-b', baseURL: 'https://api.z.ai/api/coding/paas/v4' }; return GLM_RAW })
    const registry = new PlanQuotaRegistry({
      listProviders: () => ['zai-coding'],
      resolveIdentity: async provider => identities[provider],
      request: request as never,
    })
    expect((await registry.snapshot()).providers).toEqual([])
    const next = await registry.snapshot()
    expect(next.providers).toHaveLength(1)
    expect(request).toHaveBeenCalledTimes(2)
    await registry.stop()
  })

  it('skips a provider whose credential is missing', async () => {
    const request = vi.fn(async () => GLM_RAW)
    const registry = new PlanQuotaRegistry({
      listProviders: () => ['zai-coding'],
      resolveIdentity: async () => undefined,
      request: request as never,
    })
    const snapshot = await registry.snapshot()
    expect(snapshot.providers).toEqual([])
    expect(request).not.toHaveBeenCalled()
    await registry.stop()
  })

  it('aborts in-flight requests when the plugin is unloaded', async () => {
    let aborted = false
    const request = vi.fn((_descriptor: unknown, _baseURL: string, _apiKey: string, signal: AbortSignal) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => { aborted = true; reject(new Error('aborted')) })
    }))
    const registry = new PlanQuotaRegistry({
      listProviders: () => ['zai-coding'],
      resolveIdentity: async () => ({ apiKey: 'key-a', baseURL: 'https://api.z.ai/api/coding/paas/v4' }),
      request: request as never,
    })
    const pending = registry.snapshot()
    await vi.waitFor(() => expect(request).toHaveBeenCalledOnce())
    await registry.stop()
    expect(aborted).toBe(true)
    expect((await pending).providers).toEqual([])
    expect((await registry.snapshot()).providers).toEqual([])
  })
})

describe('plan quota endpoint', () => {
  function setup() {
    const request = vi.fn(async (_descriptor: unknown, baseURL: string) => (baseURL.includes('kimi.com') ? KIMI_RAW : GLM_RAW))
    const registry = new PlanQuotaRegistry({
      listProviders: () => ['zai-coding'],
      resolveIdentity: async () => ({ apiKey: 'key-a', baseURL: 'https://api.z.ai/api/coding/paas/v4' }),
      request: request as never,
    })
    return { registry, request }
  }

  it('answers a GET with the aggregated snapshot and the shared no-store headers', async () => {
    const { registry } = setup()
    const res = response()
    await createPlanQuotaHandler(registry)({ method: 'GET', url: TOKEN_MONITOR_PLAN_QUOTAS_PATH } as never, res as never)
    expect(res.status).toBe(200)
    expect(res.headers).toMatchObject({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
    const snapshot = JSON.parse(res.body) as PlanQuotaSnapshot
    expect(snapshot.providers).toHaveLength(1)
    expect(snapshot.providers[0]).toMatchObject({ provider: 'zai-coding', label: 'GLM Coding Plan', status: 'ok' })
    await registry.stop()
  })

  it('refuses a method other than GET', async () => {
    const { registry } = setup()
    const res = response()
    await createPlanQuotaHandler(registry)({ method: 'POST', url: TOKEN_MONITOR_PLAN_QUOTAS_PATH } as never, res as never)
    expect(res.status).toBe(405)
    await registry.stop()
  })

  it('registers the exact route behind the route guard', async () => {
    const { registry } = setup()
    const routes: { path: string; handler: (request: unknown, response: unknown) => void }[] = []
    const ctx = {
      connection: { requestRejection: () => undefined },
      webServer: { register: (route: { path: string; handler: (request: unknown, response: unknown) => void }) => { routes.push(route); return () => {} } },
      effect: (fn: () => unknown) => fn(),
    } as unknown as Context
    registerPlanQuotaApi(ctx, registry)
    expect(routes[0]!.path).toBe('/api/token-monitor/plan-quotas')
    const res = response()
    await routes[0]!.handler({ method: 'GET', url: TOKEN_MONITOR_PLAN_QUOTAS_PATH }, res)
    expect(res.status).toBe(200)
    expect((JSON.parse(res.body) as PlanQuotaSnapshot).providers[0]).toMatchObject({ provider: 'zai-coding', status: 'ok' })
    await registry.stop()
  })
})
