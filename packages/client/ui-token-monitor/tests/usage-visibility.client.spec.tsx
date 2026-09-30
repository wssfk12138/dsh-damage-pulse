// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { DEFAULT_TOKEN_MONITOR_SETTINGS, TOKEN_MONITOR_SETTINGS_SCHEMA_VERSION } from '@deepseek-ai/dsh-token-monitor-contract'
import { BalanceWidget } from '../src/client/BalanceWidget.tsx'
import type { ComponentProps } from 'react'

const USAGE_OVERVIEW_KEY = 'dsh-token-monitor-show-usage-overview'
const RECORD_A = { timestamp: Date.parse('2026-09-22T10:00:00+08:00'), sessionId: 'session-1', provider: 'provider-a', model: 'model-a', inputTokens: 1200, outputTokens: 340, cacheReadTokens: 5600, firstMs: 900, totalMs: 2100 }

/** 浏览器端用量概览显示规则：开关、无脚本强制回退与来源标注。 */
afterEach(() => { cleanup(); localStorage.clear(); vi.useRealTimers(); vi.unstubAllGlobals() })

interface Scenario { script: string | number; records: Record<string, unknown> }

function stubFetch(read: () => Scenario) {
  const calls: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (input: string) => {
    const url = new URL(input, 'http://localhost')
    calls.push(url.pathname + url.search)
    if (url.pathname.endsWith('/settings')) return new Response(JSON.stringify({ schemaVersion: TOKEN_MONITOR_SETTINGS_SCHEMA_VERSION, revision: 1, settings: { ...DEFAULT_TOKEN_MONITOR_SETTINGS } }))
    if (url.pathname.endsWith('/balance-script')) {
      const script = read().script
      return typeof script === 'number' ? new Response('{}', { status: script }) : new Response(JSON.stringify({ status: script }))
    }
    if (url.pathname.endsWith('/balance')) return new Response(JSON.stringify({ totalBalance: 10, currency: 'CNY' }))
    if (url.pathname.endsWith('/charge-events')) return new Response(JSON.stringify({ events: [], seq: 0, streamId: 'test' }))
    if (url.pathname.endsWith('/overview')) return new Response(JSON.stringify(read().records[url.searchParams.get('provider') ?? ''] ?? null))
    return new Response('null')
  }))
  return calls
}

/** 会话作用域返回“未记录”时按“供应商 + 模型”再查一次：两次请求的应答分别可控。 */
function stubScopedOverviewFetch(acrossSessions: () => unknown) {
  const overviewSearches: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (input: string) => {
    const url = new URL(input, 'http://localhost')
    if (url.pathname.endsWith('/settings')) return new Response(JSON.stringify({ schemaVersion: TOKEN_MONITOR_SETTINGS_SCHEMA_VERSION, revision: 1, settings: { ...DEFAULT_TOKEN_MONITOR_SETTINGS } }))
    if (url.pathname.endsWith('/balance-script')) return new Response(JSON.stringify({ status: 'valid' }))
    if (url.pathname.endsWith('/balance')) return new Response(JSON.stringify({ totalBalance: 10, currency: 'CNY' }))
    if (url.pathname.endsWith('/charge-events')) return new Response(JSON.stringify({ events: [], seq: 0, streamId: 'test' }))
    if (url.pathname.endsWith('/overview')) {
      overviewSearches.push(url.search)
      return new Response(url.searchParams.get('sessionId') !== null ? 'null' : JSON.stringify(acrossSessions()))
    }
    return new Response('null')
  }))
  return overviewSearches
}

function mountWidget(provider: () => string) {
  const loadDisplayScope = async () => ({ provider: provider(), model: 'current-model' })
  const props = {
    useSessions: (select: (state: unknown) => unknown) => select({ byId: {} }),
    loadDisplayScope,
    t: (key: string) => key,
  } as unknown as ComponentProps<typeof BalanceWidget>
  return render(<BalanceWidget {...props} />)
}

function mountSessionWidget() {
  const loadDisplayScope = async (sessionId: string | undefined) => ({ sessionId, provider: 'provider-a', model: 'current-model' })
  return render(<BalanceWidget {...{ useSessions: (select: (state: unknown) => unknown) => select({ current: 'session-live', byId: {} }), loadDisplayScope, t: (key: string) => key } as unknown as ComponentProps<typeof BalanceWidget>} />)
}

const usageBlock = () => document.querySelector('[data-token-monitor-token-layout]')
const sourceNote = () => document.querySelector('[data-token-monitor-usage-source]')
const overviewCalls = (calls: string[]) => calls.filter(call => call.startsWith('/api/token-monitor/modules/overview'))
const settle = async (ms: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms) }) }

it('脚本有效且用户关闭用量概览时不显示概览，也不请求概览接口', async () => {
  vi.useFakeTimers()
  localStorage.setItem(USAGE_OVERVIEW_KEY, 'false')
  const calls = stubFetch(() => ({ script: 'valid', records: { 'provider-a': RECORD_A } }))
  mountWidget(() => 'provider-a')
  await settle(2500)
  expect(usageBlock()).toBeNull()
  expect(sourceNote()).toBeNull()
  expect(overviewCalls(calls)).toHaveLength(0)
})

it('脚本未配置时强制显示上一个可用模型快照，并标注来源与记录时间', async () => {
  vi.useFakeTimers()
  let scenario: Scenario = { script: 'valid', records: { 'provider-a': RECORD_A } }
  const calls = stubFetch(() => scenario)
  let provider = 'provider-a'
  mountWidget(() => provider)
  await settle(2500)
  expect(overviewCalls(calls).some(call => call.includes('provider=provider-a'))).toBe(true)
  fireEvent.contextMenu(document.querySelector('[data-token-monitor-balance]')!)
  fireEvent.click(screen.getByRole('menuitemcheckbox', { name: '显示用量概览' }))
  await settle(1500)
  expect(usageBlock()).toBeNull()
  provider = 'provider-b'
  scenario = { script: 'unconfigured', records: { 'provider-a': RECORD_A } }
  await settle(2500)
  expect(usageBlock()).not.toBeNull()
  expect(sourceNote()?.textContent).toContain('model-a')
  const title = usageBlock()?.parentElement?.getAttribute('title') ?? ''
  expect(title).toContain('供应商 provider-a')
  expect(title).toContain('模型 model-a')
  expect(title).toContain('记录时间')
})

it('余额脚本查询暂时失败按已配置处理：用户关闭时保持隐藏，用户开启时正常显示', async () => {
  vi.useFakeTimers()
  localStorage.setItem(USAGE_OVERVIEW_KEY, 'false')
  stubFetch(() => ({ script: 500, records: { 'provider-a': RECORD_A } }))
  mountWidget(() => 'provider-a')
  await settle(2500)
  expect(usageBlock()).toBeNull()
  cleanup()
  localStorage.setItem(USAGE_OVERVIEW_KEY, 'true')
  stubFetch(() => ({ script: 500, records: { 'provider-a': RECORD_A } }))
  mountWidget(() => 'provider-a')
  await settle(2500)
  expect(usageBlock()).not.toBeNull()
  expect(sourceNote()).toBeNull()
})

it('当前会话没有该模型用量时按供应商 + 模型跨会话回退，且不借用其它模型的数据', async () => {
  vi.useFakeTimers()
  let acrossSessions: unknown = { ...RECORD_A, sessionId: 'session-old', model: 'current-model' }
  const overviewSearches = stubScopedOverviewFetch(() => acrossSessions)
  mountSessionWidget()
  await settle(2500)
  expect(overviewSearches.some(search => search.includes('sessionId=session-live'))).toBe(true)
  expect(overviewSearches.some(search => !search.includes('sessionId'))).toBe(true)
  const recordTitle = () => usageBlock()?.parentElement?.getAttribute('title') ?? ''
  expect(recordTitle()).toContain('模型 current-model')
  acrossSessions = null
  await settle(1500)
  // 该模型在任何会话都没有记录时不得借用别的模型数据：概览回到未记录且不带模型归属。
  expect(recordTitle()).toContain('未记录')
  expect(recordTitle()).not.toContain('current-model')
})
