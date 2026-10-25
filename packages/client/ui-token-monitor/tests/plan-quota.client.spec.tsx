// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { PlanQuotaSnapshot } from '@deepseek-ai/dsh-token-monitor-contract'
import { UsageOverview } from '../src/client/UsageOverview.tsx'
import { resetPlanQuotaAvailability } from '../src/client/plan-quota-availability.ts'
import { PlanQuotaPanel } from '../src/client/PlanQuotaPanel.tsx'
import { zh, type DetailTranslate } from '../src/client/detail-locales.ts'

const t: DetailTranslate = (key, values) => Object.entries(values ?? {}).reduce((text, [name, value]) => text.replace('{' + name + '}', String(value)), zh[key] as string)
/** 固定本地时钟：北京时间 2026-10-23 17:00:00。 */
const now = Date.parse('2026-10-23T09:00:00Z')
const reset5h = Date.parse('2026-10-23T11:13:00Z')
const resetWeek = Date.parse('2026-10-26T01:00:00Z')
const summary = { range: 'today', from: null, to: null, spendCny: 12.3, requestCount: 200, totalTokens: 100000000, activeDays: 2, cacheHitTokens: 90000000, cacheHitRate: 0.9, costPer100mTokensCny: 12.3, activeDaySpendCny: 6.15 }
const planSnapshot: PlanQuotaSnapshot = {
  updatedAt: now,
  providers: [{
    provider: 'zhipuai', label: 'GLM Coding Plan', plan: 'pro', status: 'ok', updatedAt: now,
    windows: [
      { kind: 'month', label: '每月', usedPercent: null, used: null, total: null },
      { kind: '5h', label: '5 小时', usedPercent: 12.5, used: 25, total: 200, resetAt: reset5h },
      { kind: 'week', label: '每周', usedPercent: null, used: 30, total: 120, resetAt: resetWeek },
    ],
  }],
}
interface FakeResponse { ok: boolean; status: number; json: () => Promise<unknown> }
type Fetcher = (url: string, init: RequestInit) => Promise<FakeResponse>
const ok = (value: unknown): FakeResponse => ({ ok: true, status: 200, json: async () => value })
const fail = (status = 500): FakeResponse => ({ ok: false, status, json: async () => ({}) })

function mount(implementation: Fetcher, props: { billingInstalled?: boolean } = {}) {
  const fetcher = vi.fn(implementation)
  vi.stubGlobal('fetch', fetcher)
  const view = render(<UsageOverview t={t} compact={false} billingInstalled={props.billingInstalled} />)
  return { fetcher, ...view }
}
const defaultFetch: Fetcher = async url => ok(String(url).includes('plan-quotas') ? planSnapshot : summary)
const planCalls = (fetcher: ReturnType<typeof vi.fn>) => fetcher.mock.calls.filter(([url]) => String(url).includes('plan-quotas'))
const flush = async () => { await act(async () => {}) }
const tick = async (ms: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms) }) }

beforeEach(() => { resetPlanQuotaAvailability(); vi.useFakeTimers(); vi.setSystemTime(now) })
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); localStorage.clear() })

it('打开窗口时探测一次：有套餐才出现页签，默认仍停在消费概览', async () => {
  const { fetcher } = mount(defaultFetch)
  await flush()
  const overview = within(screen.getByRole('region', { name: '数据概览' }))
  for (const label of ['消费', '请求数', 'Token 总数', '活跃天数', '缓存命中 Token', '缓存命中率', '每亿 Token 费用', '活跃日均消费']) {
    expect(overview.getByText(label)).toBeTruthy()
  }
  expect(overview.getByText('¥12.3')).toBeTruthy()
  expect(overview.getByRole('button', { name: '消费概览' }).getAttribute('aria-pressed')).toBe('true')
  expect(overview.getByRole('button', { name: 'Plan 额度' }).getAttribute('aria-pressed')).toBe('false')
  // 页签是否显示取决于「有没有真套餐」，必须在用户点开之前就知道，因此开窗时探测一次。
  expect(planCalls(fetcher)).toHaveLength(1)
})

it('供应商只是配了 key 而没有套餐时，不显示 Plan 额度页签', async () => {
  // Host 对「没有套餐」返回空 providers，客户端据此完全不露出这个页签。
  const { fetcher } = mount(async url => String(url).includes('plan-quotas')
    ? ok({ updatedAt: now, providers: [] })
    : ok(summary))
  await flush()
  expect(screen.queryByRole('button', { name: 'Plan 额度' })).toBeNull()
  expect(screen.getByRole('button', { name: '消费概览' })).toBeTruthy()
  await tick(120_000)
  // 没有页签就不会继续轮询。
  expect(planCalls(fetcher)).toHaveLength(1)
})

it('探测失败时不显示页签，并在短时间内不再重复探测', async () => {
  const { fetcher } = mount(async url => String(url).includes('plan-quotas') ? fail(500) : ok(summary))
  await flush()
  expect(screen.queryByRole('button', { name: 'Plan 额度' })).toBeNull()
  await tick(30_000)
  expect(planCalls(fetcher)).toHaveLength(1)
})

it('切到 Plan 额度后渲染供应商、窗口名、已用百分比与下次刷新时间', async () => {
  const { fetcher } = mount(defaultFetch)
  await flush()
  fireEvent.click(screen.getByRole('button', { name: 'Plan 额度' }))
  await flush()
  // 开窗探测一次，进入页签后再加载一次。
  expect(planCalls(fetcher)).toHaveLength(2)
  expect(planCalls(fetcher)[1]?.[1]).toMatchObject({ cache: 'no-store' })
  expect(screen.getByText('GLM Coding Plan')).toBeTruthy()
  expect(screen.getByText('zhipuai')).toBeTruthy()
  expect(screen.getByText('套餐 pro')).toBeTruthy()
  expect(screen.getByText('5 小时')).toBeTruthy()
  // 右侧百分比与进度条同为剩余口径：已用 12.5% → 「剩余 87.5%」。
  expect(screen.getByText('剩余 87.5%')).toBeTruthy()
  expect(screen.getByText('已用 25 / 200')).toBeTruthy()
  expect(screen.getByText('2026-10-23 19:13:00')).toBeTruthy()
  expect(screen.getByText('还剩 2 小时 13 分')).toBeTruthy()
  expect(screen.getByText('还剩 2 天 16 小时')).toBeTruthy()
  // 窗口顺序固定为 5h → week → month。
  expect(screen.getAllByRole('progressbar').map(node => node.getAttribute('aria-label'))).toEqual(['5 小时', '每周', '每月'])
})

it('三家供应商的百分比与进度条统一按剩余口径渲染', async () => {
  // Host 归一化层保证 usedPercent 恒为「已用份额」：
  // GLM 取接口 percentage（实测=已用）、Kimi 由 used/limit 折算、
  // MiniMax 由 100−*_remaining_percent 折算（实测该字段是剩余）。
  // 这里用三家各一窗口的快照锁死客户端渲染：百分比文本、条宽、valuenow 全为剩余。
  const snapshot: PlanQuotaSnapshot = {
    updatedAt: now,
    providers: [
      { provider: 'zai-coding-cn', label: 'GLM Coding Plan', status: 'ok', updatedAt: now,
        windows: [{ kind: '5h', label: 'GLM', usedPercent: 74, used: null, total: null, resetAt: reset5h }] },
      { provider: 'kimi-coding', label: 'Kimi Coding Plan', status: 'ok', updatedAt: now,
        windows: [{ kind: '5h', label: 'Kimi', usedPercent: 25, used: 30, total: 120, resetAt: resetWeek }] },
      { provider: 'minimax-cn', label: 'MiniMax M Plan', status: 'ok', updatedAt: now,
        windows: [{ kind: 'week', label: 'MiniMax', usedPercent: 100, used: null, total: null, resetAt: resetWeek }] },
    ],
  }
  mount(async url => ok(String(url).includes('plan-quotas') ? snapshot : summary))
  await flush()
  fireEvent.click(screen.getByRole('button', { name: 'Plan 额度' }))
  await flush()
  // 窗口顺序固定 5h → week → month：GLM、Kimi、MiniMax 各占一档。
  const bars = screen.getAllByRole('progressbar')
  expect(bars).toHaveLength(3)
  const [glmBar, kimiBar, miniMaxBar] = bars
  // GLM：已用 74% → 剩余 26.0%，条宽 26%。
  expect(screen.getByText('剩余 26.0%')).toBeTruthy()
  expect(glmBar!.getAttribute('aria-valuenow')).toBe('26')
  expect((glmBar!.firstElementChild as HTMLElement).style.width).toBe('26%')
  // Kimi：已用 25% → 剩余 75.0%。
  expect(screen.getByText('剩余 75.0%')).toBeTruthy()
  expect(kimiBar!.getAttribute('aria-valuenow')).toBe('75')
  // MiniMax：已用 100% → 红字「已耗尽」，不显示百分比。
  expect(screen.getByText('已耗尽')).toBeTruthy()
  expect(miniMaxBar!.getAttribute('aria-valuenow')).toBe('0')
  expect(screen.queryByText('剩余 0.0%')).toBeNull()
})

it('额度用尽时以红字「已耗尽」取代数值区', async () => {
  const snapshot: PlanQuotaSnapshot = {
    updatedAt: now,
    providers: [{
      provider: 'zhipuai', label: 'GLM Coding Plan', status: 'ok', updatedAt: now,
      windows: [{ kind: 'week', label: '每周', usedPercent: 100, used: 100, total: 100, resetAt: resetWeek }],
    }],
  }
  mount(async url => ok(String(url).includes('plan-quotas') ? snapshot : summary))
  await flush()
  fireEvent.click(screen.getByRole('button', { name: 'Plan 额度' }))
  await flush()
  expect(screen.getByText('已耗尽')).toBeTruthy()
  // 不再展示 100/100 与 100.0% 的读数。
  expect(screen.queryByText('已用 100 / 100')).toBeNull()
  expect(screen.queryByText('剩余 0.0%')).toBeNull()
  // 进度条以剩余渲染：耗尽 → 空条；valuetext 同步为「已耗尽」。
  const bar = screen.getByRole('progressbar', { name: '每周' })
  expect(bar.getAttribute('aria-valuenow')).toBe('0')
  expect(bar.getAttribute('aria-valuetext')).toBe('已耗尽')
  const fill = bar.firstElementChild as HTMLElement
  expect(fill.style.width).toBe('0%')
})

it('进度条带有 progressbar 角色与无障碍数值，没有百分比时改用 valuetext', async () => {
  mount(defaultFetch)
  await flush()
  fireEvent.click(screen.getByRole('button', { name: 'Plan 额度' }))
  await flush()
  // 进度条按「剩余额度」渲染：已用 12.5% → 剩余 87.5（条越用越短，空=用尽）。
  const bar = screen.getByRole('progressbar', { name: '5 小时' })
  expect(bar.getAttribute('aria-valuemin')).toBe('0')
  expect(bar.getAttribute('aria-valuemax')).toBe('100')
  expect(bar.getAttribute('aria-valuenow')).toBe('88')
  const weekly = screen.getByRole('progressbar', { name: '每周' })
  expect(weekly.getAttribute('aria-valuenow')).toBe('75')
  const monthly = screen.getByRole('progressbar', { name: '每月' })
  expect(monthly.getAttribute('aria-valuenow')).toBeNull()
  expect(monthly.getAttribute('aria-valuetext')).toBe('未记录')
  expect(screen.getByText('未记录')).toBeTruthy()
  // 未知额度不能画成满条（满条在新口径下等于「额度充足」）：空条 + 弱化样式。
  const unknownFill = monthly.firstElementChild as HTMLElement
  expect(unknownFill.style.width).toBe('0%')
  expect(unknownFill.getAttribute('data-level')).toBe('unknown')
})

it('面板加载失败时给出错误提示与重试入口', async () => {
  // 页签已经由探测确认有套餐，这里只覆盖面板自身的失败与重试。
  let broken = true
  const fetcher = vi.fn(async url => String(url).includes('plan-quotas') ? (broken ? fail() : ok(planSnapshot)) : ok(summary))
  vi.stubGlobal('fetch', fetcher)
  render(<PlanQuotaPanel t={t} active />)
  await flush()
  expect(screen.getByRole('alert').textContent).toContain('Plan 额度加载失败，请重试')
  expect(screen.queryByText('GLM Coding Plan')).toBeNull()
  broken = false
  fireEvent.click(screen.getByRole('button', { name: '重试' }))
  await flush()
  expect(screen.getByText('GLM Coding Plan')).toBeTruthy()
  expect(planCalls(fetcher)).toHaveLength(2)
})

it('单个供应商查询失败时只提示该供应商，其它供应商照常渲染', async () => {
  const mixed: PlanQuotaSnapshot = {
    updatedAt: now,
    providers: [
      { provider: 'moonshot', label: 'Moonshot Plan', status: 'error', updatedAt: now, windows: [] },
      planSnapshot.providers[0]!,
    ],
  }
  mount(async url => ok(String(url).includes('plan-quotas') ? mixed : summary))
  await flush()
  fireEvent.click(screen.getByRole('button', { name: 'Plan 额度' }))
  await flush()
  expect(screen.getByText('Moonshot Plan')).toBeTruthy()
  expect(screen.getByText('额度查询失败')).toBeTruthy()
  expect(screen.getByText('GLM Coding Plan')).toBeTruthy()
  // 右侧百分比与进度条同为剩余口径：已用 12.5% → 「剩余 87.5%」。
  expect(screen.getByText('剩余 87.5%')).toBeTruthy()
})

it('单个供应商字段非法时只丢这一家，其余供应商照常渲染', async () => {
  // Client 侧不能因为一家字段异常就把整页判成加载失败。
  mount(async url => ok(String(url).includes('plan-quotas') ? {
    updatedAt: now,
    providers: [
      planSnapshot.providers[0],
      { provider: 'broken', label: 'Broken Plan', status: 'ok', updatedAt: now, windows: [{ kind: 'week', label: '每周', usedPercent: 'x', used: 1, total: 10 }] },
    ],
  } : summary))
  await flush()
  fireEvent.click(screen.getByRole('button', { name: 'Plan 额度' }))
  await flush()
  expect(screen.queryByText('Plan 额度加载失败，请重试')).toBeNull()
  expect(screen.getByText('GLM Coding Plan')).toBeTruthy()
  expect(screen.queryByText('Broken Plan')).toBeNull()
})

it('刷新时间已过但仍是 100% 时只说等待刷新，不与「已耗尽」并列', async () => {
  const expired = now - 60_000
  mount(async url => ok(String(url).includes('plan-quotas') ? {
    updatedAt: now,
    providers: [{ provider: 'zhipuai', label: 'GLM Coding Plan', status: 'ok', updatedAt: now, windows: [
      { kind: 'week', label: '每周', usedPercent: 100, used: 100, total: 100, resetAt: expired },
    ] }],
  } : summary))
  await flush()
  fireEvent.click(screen.getByRole('button', { name: 'Plan 额度' }))
  await flush()
  expect(screen.getByText('已用尽，等待刷新')).toBeTruthy()
  expect(screen.queryByText('已耗尽')).toBeNull()
  expect(screen.queryByText('已到期')).toBeNull()
  expect(screen.getByText('等待刷新')).toBeTruthy()
})

it('停留在 Plan 页签时每 60 秒刷新一次，切走后停止轮询', async () => {
  const { fetcher } = mount(defaultFetch)
  await flush()
  fireEvent.click(screen.getByRole('button', { name: 'Plan 额度' }))
  await flush()
  // 第一次是开窗探测，第二次是页签自己的加载。
  expect(planCalls(fetcher)).toHaveLength(2)
  await tick(59000)
  expect(planCalls(fetcher)).toHaveLength(2)
  await tick(1000)
  expect(planCalls(fetcher)).toHaveLength(3)
  fireEvent.click(screen.getByRole('button', { name: '消费概览' }))
  await flush()
  const calls = planCalls(fetcher).length
  await tick(120000)
  expect(planCalls(fetcher)).toHaveLength(calls)
  expect(screen.getByText('¥12.3')).toBeTruthy()
})

it('未启用计费规则时不显示 Plan 额度页签，也不发起该请求', async () => {
  const { fetcher } = mount(defaultFetch, { billingInstalled: false })
  await flush()
  expect(screen.queryByRole('button', { name: 'Plan 额度' })).toBeNull()
  expect(screen.getByRole('button', { name: '消费概览' })).toBeTruthy()
  expect(planCalls(fetcher)).toHaveLength(0)
})

it('剩余时长随本地时钟每 30 秒推进一次', async () => {
  const near: PlanQuotaSnapshot = {
    updatedAt: now,
    providers: [{
      provider: 'zhipuai', label: 'GLM Coding Plan', status: 'ok', updatedAt: now,
      windows: [{ kind: '5h', label: '5 小时', usedPercent: 10, used: 20, total: 200, resetAt: now + 45_000 }],
    }],
  }
  mount(async url => ok(String(url).includes('plan-quotas') ? near : summary))
  await flush()
  fireEvent.click(screen.getByRole('button', { name: 'Plan 额度' }))
  await flush()
  expect(screen.getByText('还剩 45 秒')).toBeTruthy()
  await tick(30_000)
  expect(screen.getByText('还剩 15 秒')).toBeTruthy()
  await tick(30_000)
  expect(screen.getByText('已到期')).toBeTruthy()
})
+
it('面板在没有任何供应商时显示空态（页签本身已由探测隐藏）', async () => {
  vi.stubGlobal('fetch', vi.fn(async url => String(url).includes('plan-quotas') ? ok({ updatedAt: now, providers: [] }) : ok(summary)))
  render(<PlanQuotaPanel t={t} active />)
  await flush()
  expect(screen.getByText('当前没有可用的 Plan 额度')).toBeTruthy()
  expect(screen.queryByRole('progressbar')).toBeNull()
})

it('确认有套餐后，重开窗口复用结论，不再重复探测', async () => {
  const first = mount(defaultFetch)
  await flush()
  expect(screen.getByRole('button', { name: 'Plan 额度' })).toBeTruthy()
  first.unmount()
  const second = mount(defaultFetch)
  await flush()
  expect(screen.getByRole('button', { name: 'Plan 额度' })).toBeTruthy()
  // 缓存期内重开只复用上次结论，不再多发探测请求。
  expect(planCalls(second.fetcher)).toHaveLength(0)
})

it('否定的探测结果不缓存：刚开通套餐后重开窗口就能看到页签', async () => {
  const first = mount(async url => String(url).includes('plan-quotas')
    ? ok({ updatedAt: now, providers: [] })
    : ok(summary))
  await flush()
  expect(screen.queryByRole('button', { name: 'Plan 额度' })).toBeNull()
  first.unmount()
  // 同一进程内重新打开：这次 Host 已经报告了套餐。
  const second = mount(defaultFetch)
  await flush()
  expect(screen.getByRole('button', { name: 'Plan 额度' })).toBeTruthy()
})

