// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { DetailPage } from '@deepseek-ai/dsh-token-monitor-contract'
import { UsageDetailsWindow } from '../src/client/UsageDetailsWindow.tsx'
import { zh, type DetailTranslate } from '../src/client/detail-locales.ts'
import { beijingDateTime, clampWindow, latencyTone, resizeWindow, type ResizeEdge } from '../src/client/detail-model.ts'
import { overviewNumber, UsageOverview } from '../src/client/UsageOverview.tsx'

const t: DetailTranslate = (key, values) => Object.entries(values ?? {}).reduce((text, [name, value]) => text.replace('{' + name + '}', String(value)), zh[key] as string)
const time = Date.parse('2026-09-14T02:01:02Z')
const payload = { snapshot: 'snapshot-1', capturedAt: time, rows: [
  { id: 'a', sessionId: 'one', provider: 'deepseek-official', model: 'deepseek-v4-flash', status: 'success', timestamp: time, inputTokens: 1234, outputTokens: 56, cacheReadTokens: 40000, cost: 0.012345, peak: true, firstMs: 2000, totalMs: 190000 },
  { id: 'b', sessionId: 'two', provider: 'deepseek-official', model: 'deepseek-v4-pro', status: 'success', timestamp: time, peak: false },
], total: 21, page: 1, pages: 2, size: 20, sessions: [{ id: 'one', title: '同名对话', project: 'Project A', child: false }, { id: 'two', title: '同名对话', project: 'Project B', child: true, parent: 'one' }], models: ['deepseek-v4-flash', 'deepseek-v4-pro'] }
afterEach(() => { cleanup(); vi.unstubAllGlobals(); localStorage.clear() })
const summary = { range: 'today', from: '2026-09-14', to: '2026-09-14', spendCny: 12.3, requestCount: 200, totalTokens: 100000000, activeDays: 2, cacheHitTokens: 90000000, cacheHitRate: 0.9, costPer100mTokensCny: 12.3, activeDaySpendCny: 6.15 }
function mount(response: DetailPage = payload as DetailPage) {
  const fetcher = vi.fn(async (input: string, _options: RequestInit) => ({ ok: true, json: async () => input.includes('usage-summary') ? { ...summary, range: new URL(input, 'http://localhost').searchParams.get('range') } : response }))
  vi.stubGlobal('fetch', fetcher)
  const close = vi.fn()
  render(<><input aria-label="background chat" /><UsageDetailsWindow t={t} onClose={close} /></>)
  return { fetcher, close }
}

it('places eight centered overview metrics above filters and keeps overview and detail ranges synchronized', async () => {
  const { fetcher } = mount()
  const overview = within(screen.getByRole('region', { name: '数据概览' }))
  await overview.findByText('¥12.3')
  expect(overview.getByText('活跃日均消费').parentElement?.textContent).toBe('活跃日均消费6.15元/天')
  expect(overview.getByText('每亿 Token 费用').parentElement?.textContent).toBe('每亿 Token 费用12.3元/亿')
  expect(overview.getByText('消费').parentElement?.parentElement?.textContent).toMatchInlineSnapshot(
    '"消费¥12.3请求数200Token 总数1亿活跃天数2天缓存命中 Token9,000万缓存命中率90%每亿 Token 费用12.3元/亿活跃日均消费6.15元/天"',
  )
  expect(screen.getByRole('region', { name: '数据概览' }).compareDocumentPosition(screen.getByLabelText('模型')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  fireEvent.click(overview.getByRole('button', { name: '7天' }))
  await waitFor(() => { expect(fetcher.mock.calls.some(([url]) => String(url).includes('usage-summary?range=7d'))).toBe(true) })
  await overview.findByText('¥12.3')
  const summaryCalls = () => fetcher.mock.calls.filter(([url]) => url.includes('usage-summary')).length
  expect(summaryCalls()).toBe(2)
  await waitFor(() => { expect(String(fetcher.mock.calls.at(-1)?.[0])).toContain('range=7d') })
  fireEvent.change(screen.getByLabelText('模型'), { target: { value: 'deepseek-v4-pro' } })
  await screen.findByText('¥0.012345')
  fireEvent.click(screen.getByRole('button', { name: '错误请求' }))
  await screen.findByText('¥0.012345')
  expect(summaryCalls()).toBe(2)
  expect(overview.getByRole('button', { name: '7天' }).getAttribute('aria-pressed')).toBe('true')
  fireEvent.click(screen.getAllByRole('button', { name: '今日' }).at(-1)!)
  await waitFor(() => { expect(overview.getByRole('button', { name: '今日' }).getAttribute('aria-pressed')).toBe('true') })
  fireEvent.click(overview.getByRole('button', { name: '收起概览' }))
  expect(overview.queryByRole('group', { name: '概览时间范围' })).toBeNull()
})

it('formats overview decimals, tiny positive values and absent averages', () => {
  expect([12, 12.3, 12.345, 0, 0.001, null].map(value => overviewNumber(value))).toEqual(['12', '12.3', '12.35', '0', '<0.01', '—'])
})

it('shows failed overview values as unknown and allows retry', async () => {
  const fetcher = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ ok: true, json: async () => ({ ...summary, totalTokens: 0, costPer100mTokensCny: null, activeDaySpendCny: null }) })
  vi.stubGlobal('fetch', fetcher)
  render(<UsageOverview t={t} compact={false} />)
  await screen.findByRole('alert')
  expect(screen.getAllByText('—')).toHaveLength(8)
  fireEvent.click(screen.getByRole('button', { name: '刷新概览' }))
  await screen.findByText('¥12.3')
  expect(screen.getAllByText('—')).toHaveLength(2)
})

it('ignores a stale overview response after the user changes the time range', async () => {
  let resolveOld!: (response: unknown) => void
  const fetcher = vi.fn().mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve }))
    .mockResolvedValue({ ok: true, json: async () => ({ ...summary, range: '7d', spendCny: 77 }) })
  vi.stubGlobal('fetch', fetcher)
  render(<UsageOverview t={t} compact={false} />)
  fireEvent.click(screen.getByRole('button', { name: '7天' }))
  await screen.findByText('¥77')
  resolveOld({ ok: true, json: async () => summary })
  await waitFor(() => { expect(screen.queryByText('¥12.3')).toBeNull() })
  expect(screen.getByText('¥77')).toBeTruthy()
})

it('shows frozen fee facts in an anchored panel and leaves absent historical subtotals unknown without fetching current prices', async () => {
  const response = structuredClone(payload) as DetailPage
  Object.assign(response.rows[0]!, {
    inputTokens: 1000, cacheReadTokens: 2000, cacheWriteTokens: 3000, outputTokens: 4000,
    cost: 0.049, modelMultiplier: 2,
    feeExplanation: {
      costInput: 0.004, costCacheRead: 0.001, costCacheWrite: 0.012, costOutput: 0.032,
      applied: { ruleId: 'a'.repeat(64), mode: 'offPeak', tierMax: 32000, rate: { input: 2, cacheHit: 0.25, cacheWrite: 2, output: 4 } },
    },
  })
  Object.assign(response.rows[1]!, { cost: 6, feeExplanation: { costInput: 1, costOutput: 3 } })
  const { fetcher } = mount(response)
  await screen.findByText('¥0.049000')
  const calls = fetcher.mock.calls.length
  const buttons = screen.getAllByRole('button', { name: '费用明细' })
  expect(buttons[0]!.parentElement?.textContent).toBe('¥0.049000i')
  fireEvent.pointerEnter(buttons[0]!)
  const explanation = within(await screen.findByRole('region', { name: '费用明细' }))
  await explanation.findByText('未缓存输入费用')
  const fields = (label: string) => explanation.getByText(label).nextElementSibling?.textContent
  expect(fields('未缓存输入费用')).toBe('¥0.004000')
  expect(fields('缓存命中费用')).toBe('¥0.001000')
  expect(fields('缓存写入费用')).toBe('¥0.012000')
  expect(fields('输出费用')).toBe('¥0.032000')
  expect(fields('未缓存输入 Token')).toBe('1,000')
  expect(fields('缓存命中 Token')).toBe('2,000')
  expect(fields('缓存写入 Token')).toBe('3,000')
  expect(fields('输出 Token（含推理）')).toBe('4,000')
  expect(fields('输入单价')).toBe('¥2 / 百万 Token')
  expect(fields('缓存命中单价')).toBe('¥0.25 / 百万 Token')
  expect(fields('缓存写入单价')).toBe('¥2 / 百万 Token')
  expect(fields('输出单价')).toBe('¥4 / 百万 Token')
  expect(fields('实际计价模式')).toBe('低谷')
  expect(fields('命中阶梯上限')).toBe('32,000')
  expect(fields('倍率')).toBe('2')
  expect(fields('合计（元）')).toBe('¥0.049000')
  expect(fields('规则标识')).toBe('a'.repeat(64))
  expect(buttons[0]!.getAttribute('aria-expanded')).toBe('true')
  fireEvent.click(buttons[0]!)
  fireEvent.pointerLeave(buttons[0]!)
  expect(screen.getByRole('region', { name: '费用明细' })).toBeTruthy()
  fireEvent.click(buttons[1]!)
  const legacy = within(screen.getByRole('region', { name: '费用明细' }))
  expect(legacy.getByText('未缓存输入费用').nextElementSibling?.textContent).toBe('¥1.000000')
  expect(legacy.getByText('缓存命中费用').nextElementSibling?.textContent).toBe('未记录')
  expect(legacy.getByText('缓存写入费用').nextElementSibling?.textContent).toBe('未记录')
  expect(legacy.getByText('输出费用').nextElementSibling?.textContent).toBe('¥3.000000')
  expect(legacy.getByText('合计（元）').nextElementSibling?.textContent).toBe('¥6.000000')
  fireEvent.keyDown(buttons[1]!, { key: 'Escape' })
  expect(screen.queryByRole('region', { name: '费用明细' })).toBeNull()
  fireEvent.click(buttons[1]!)
  fireEvent.keyDown(screen.getByRole('region', { name: '费用明细' }), { key: 'Escape' })
  expect(screen.queryByRole('region', { name: '费用明细' })).toBeNull()
  expect(document.activeElement).toBe(buttons[1])
  fireEvent.click(buttons[1]!)
  fireEvent.pointerDown(screen.getByLabelText('background chat'))
  expect(screen.queryByRole('region', { name: '费用明细' })).toBeNull()
  expect(fetcher).toHaveBeenCalledTimes(calls)
})

it('renders keyless visible output with two-line tokens, timings, exact fee and historical peak', async () => {
  mount(); await screen.findByText('¥0.012345')
  expect(screen.getByRole('dialog').getAttribute('aria-modal')).toBe('false')
  expect(screen.getByTitle('未缓存输入: 1234').textContent).toBe('↓ 1.2K')
  expect(screen.getByTitle('缓存命中: 40000').textContent).toBe('◉ 40.0K')
  const text = screen.getByRole('table').textContent
  expect(text).toMatchInlineSnapshot('"模型对话Token本地费用延迟记录时间deepseek-v4-flashdeepseek-official同名对话Project A↓ 1.2K　↑ 56◉ 40.0K¥0.012345i首字 2.00 s总耗时 190.00 s2026-09-1410:01:02峰deepseek-v4-pro子代理同名对话Project B↓ 未记录　↑ 未记录◉ 未记录未记录i首字 未记录总耗时 未记录2026-09-1410:01:02谷"')
  fireEvent.change(screen.getByLabelText('background chat'), { target: { value: 'still usable' } })
  expect((screen.getByLabelText('background chat') as HTMLInputElement).value).toBe('still usable')
})
it('applies explicit dates only on click and keeps snapshot across filtering/paging until refresh', async () => {
  const { fetcher } = mount(); await screen.findByText('¥0.012345')
  const initialCalls = fetcher.mock.calls.length
  fireEvent.change(screen.getByLabelText('开始时间'), { target: { value: '2026-09-01T00:00:00' } })
  expect(fetcher).toHaveBeenCalledTimes(initialCalls)
  fireEvent.click(screen.getByText('应用时间'))
  await waitFor(() => expect(String(fetcher.mock.calls.at(-1)?.[0])).toContain('range=custom'))
  expect(String(fetcher.mock.calls.at(-1)?.[0])).toContain('snapshot=snapshot-1')
  await screen.findByText('¥0.012345'); fireEvent.change(screen.getByLabelText('对话'), { target: { value: '同名' } })
  await waitFor(() => expect(String(fetcher.mock.calls.at(-1)?.[0])).toContain('sessionText='))
  await screen.findByText('¥0.012345'); fireEvent.click(screen.getByText('刷新'))
  await waitFor(() => expect(String(fetcher.mock.calls.at(-1)?.[0])).not.toContain('snapshot='))
})
it('requires confirmation to reset filters and only reads records after acceptance', async () => {
  const { fetcher } = mount()
  await screen.findByText('¥0.012345')
  fireEvent.change(screen.getByLabelText('模型'), { target: { value: 'deepseek-v4-pro' } })
  await screen.findByText('¥0.012345')
  const calls = fetcher.mock.calls.length
  const confirm = vi.fn().mockReturnValue(false)
  vi.stubGlobal('confirm', confirm)
  fireEvent.click(screen.getByText('重置筛选'))
  expect(confirm).toHaveBeenCalledWith(expect.stringContaining('不会删除任何用量记录'))
  expect(fetcher).toHaveBeenCalledTimes(calls)
  expect((screen.getByLabelText('模型') as HTMLInputElement).value).toBe('deepseek-v4-pro')
  confirm.mockReturnValue(true)
  fireEvent.click(screen.getByText('重置筛选'))
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(calls + 1))
  expect((screen.getByLabelText('模型') as HTMLInputElement).value).toBe('')
  const [url, options] = fetcher.mock.calls.at(-1)!
  expect(String(url)).toContain('range=today')
  expect(String(url)).toContain('page=1')
  expect(options.method).toBeUndefined()
})
it('maximizes, restores, remembers geometry and closes without closing the chat', async () => {
  const { close } = mount(); await screen.findByText('¥0.012345')
  const dialog = screen.getByRole('dialog'), initial = dialog.style.width
  fireEvent.click(screen.getByLabelText('最大化')); expect(dialog.style.left).toBe('8px')
  fireEvent.click(screen.getByLabelText('还原')); expect(dialog.style.width).toBe(initial)
  fireEvent.keyDown(screen.getByLabelText('调整窗口大小 · 右下角'), { key: 'ArrowLeft' })
  expect(JSON.parse(localStorage.getItem('token-monitor.details.geometry.v1')!).width).toBeLessThan(parseFloat(initial))
  fireEvent.click(screen.getByLabelText('关闭')); expect(close).toHaveBeenCalledOnce()
})
it('anchors the opposite side for all eight resize directions and stops at viewport and minimum dimensions', () => {
  const initial = { x: 200, y: 200, width: 600, height: 500 }
  const edges: ResizeEdge[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']
  for (const edge of edges) {
    const rect = resizeWindow(initial, edge, 30, 40, 1400, 1000)
    expect(rect.x).toBe(edge.includes('w') ? 230 : 200)
    expect(rect.y).toBe(edge.includes('n') ? 240 : 200)
    expect(rect.width).toBe(edge.includes('w') ? 570 : edge.includes('e') ? 630 : 600)
    expect(rect.height).toBe(edge.includes('n') ? 460 : edge.includes('s') ? 540 : 500)
  }
  expect(resizeWindow(initial, 'nw', 9999, 9999, 1400, 1000)).toEqual({ x: 480, y: 420, width: 320, height: 280 })
  expect(resizeWindow(initial, 'nw', -9999, -9999, 1400, 1000)).toEqual({ x: 8, y: 8, width: 792, height: 692 })
  expect(resizeWindow(initial, 'se', 9999, 9999, 1400, 1000)).toEqual({ x: 200, y: 200, width: 1192, height: 792 })
})
it('provides eight resize handles and retains every selected column when the window shrinks', async () => {
  localStorage.setItem('token-monitor.details.geometry.v1', JSON.stringify({ x: 8, y: 8, width: 340, height: 300 }))
  mount()
  await screen.findAllByText('¥0.012345')
  expect(screen.getAllByRole('separator')).toHaveLength(8)
  expect(screen.getByRole('dialog').dataset.compact).toBe('true')
  expect(screen.getByRole('button', { name: '展开筛选' }).getAttribute('aria-expanded')).toBe('false')
  expect(screen.getAllByRole('columnheader').map(node => node.textContent)).toEqual(['模型', '对话', 'Token', '本地费用', '延迟', '记录时间'])
  fireEvent.click(screen.getByRole('button', { name: '展开筛选' }))
  expect(screen.getByRole('button', { name: '收起筛选' }).getAttribute('aria-expanded')).toBe('true')
})
it('persists columns independently of filters and restores defaults without refetching', async () => {
  const { fetcher, close } = mount(); await screen.findByText('¥0.012345')
  const calls = fetcher.mock.calls.length
  fireEvent.click(screen.getByRole('button', { name: '列设置' }))
  fireEvent.click(screen.getByRole('menuitem', { name: 'Provider' }))
  fireEvent.click(screen.getByRole('menuitem', { name: '模型' }))
  expect(screen.queryByRole('columnheader', { name: '模型' })).toBeNull()
  expect(screen.getByRole('columnheader', { name: 'Provider' })).toBeTruthy()
  for (const row of screen.getAllByRole('row').slice(1)) expect(within(row).getAllByRole('cell')).toHaveLength(screen.getAllByRole('columnheader').length)
  expect(fetcher).toHaveBeenCalledTimes(calls)
  fireEvent.keyDown(screen.getByRole('menuitem', { name: '模型' }), { key: 'Escape' })
  expect(close).not.toHaveBeenCalled(); expect(screen.queryByRole('menu')).toBeNull()
  vi.stubGlobal('confirm', () => true)
  fireEvent.click(screen.getByRole('button', { name: '重置筛选' }))
  await screen.findByText('¥0.012345')
  expect(screen.queryByRole('columnheader', { name: '模型' })).toBeNull()
  cleanup(); mount(); await screen.findByText('¥0.012345')
  expect(screen.getByRole('columnheader', { name: 'Provider' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '列设置' }))
  fireEvent.click(screen.getByRole('menuitem', { name: '恢复默认列' }))
  expect(screen.getByRole('columnheader', { name: '模型' })).toBeTruthy()
  expect(screen.queryByRole('columnheader', { name: 'Provider' })).toBeNull()
  // The current primitives render menus in a portal; dismiss by pointing at
  // the document surface rather than at another element inside the dialog.
  fireEvent.pointerDown(document.body)
  expect(screen.queryByRole('menu')).toBeNull()
})
it('sanitizes stale preferences and never permits an empty usage table', async () => {
  localStorage.setItem('dsh-token-monitor.detail-columns', JSON.stringify(['status', 'obsolete']))
  mount(); await screen.findByRole('table')
  expect(screen.getAllByRole('columnheader').map(node => node.textContent)).toEqual(['模型', '记录时间'])
  fireEvent.click(screen.getByRole('button', { name: '列设置' }))
  fireEvent.click(screen.getByRole('menuitem', { name: '记录时间' }))
  expect((screen.getByRole('menuitem', { name: '模型' }) as HTMLButtonElement).disabled).toBe(true)
  fireEvent.click(screen.getByRole('menuitem', { name: '恢复默认列' }))
  fireEvent.keyDown(screen.getByRole('menuitem', { name: '恢复默认列' }), { key: 'Tab' })
  expect(screen.queryByRole('menu')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '错误请求' }))
  await screen.findByRole('table')
  expect(screen.getByRole('columnheader', { name: '状态' })).toBeTruthy()
})
it('handles independent latency thresholds and keeps a resized window within a narrow viewport', () => {
  expect([undefined, 5000, 15000, 15001].map(ms => latencyTone(ms))).toEqual(['unknown', 'good', 'warn', 'bad'])
  expect([60000, 180000, 180001].map(ms => latencyTone(ms, true))).toEqual(['good', 'warn', 'bad'])
  const rect = clampWindow({ x: 1200, y: 900, width: 1100, height: 700 }, 390, 640)
  expect(rect.x + rect.width).toBeLessThanOrEqual(382); expect(rect.y + rect.height).toBeLessThanOrEqual(632)
  expect(beijingDateTime(time)).toBe('2026-09-14T10:01:02')
})
