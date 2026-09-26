// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { BillingRulesPanel } from '../src/client/BillingRulesPanel.tsx'
import { zh } from '../src/client/detail-locales.ts'
import type { DetailTranslate } from '../src/client/detail-locales.ts'
import type { BillingRules, BillingSnapshot } from '@deepseek-ai/dsh-token-monitor-contract'
import { createBillingEvents } from '../src/client/billingEvents.ts'

let stopEvents: (() => void) | undefined

it('retains a newly selected model and newer edits while an earlier autosave finishes', async () => {
  mount()
  fireEvent.click(await screen.findByRole('button', { name: 'deepseek-official / deepseek-v4-flash' }))
  let finish!: (value: Response) => void
  vi.mocked(fetch).mockImplementationOnce(() => new Promise<Response>((resolve) => { finish = resolve }))
  fireEvent.change(screen.getByRole('textbox', { name: '倍率' }), { target: { value: '3' } })
  await waitFor(() => { expect(finish).toBeTypeOf('function') })
  const sent = JSON.parse(vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === 'PUT')![1]!.body as string)
  fireEvent.change(screen.getByRole('textbox', { name: '倍率' }), { target: { value: '4' } })
  fireEvent.click(screen.getByRole('button', { name: 'openai / gpt-5.4' }))
  await act(async () => { finish({ ok: true, json: async () => ({ revision: 4, rules: sent.rules }) } as Response) })
  expect(screen.getByRole<HTMLInputElement>('textbox', { name: '倍率' }).value).toBe('1')
  fireEvent.change(screen.getByRole('textbox', { name: '倍率' }), { target: { value: '2' } })
  await screen.findByText(zh.billingSaved)
  const requests = vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === 'PUT')
  const last = JSON.parse(requests.at(-1)![1]!.body as string)
  expect(last.expectedRevision).toBe(4)
  expect(last.rules.providers[0].models[0].multiplier).toBe(4)
  expect(last.rules.providers[1].models[0].multiplier).toBe(2)
})

it('advances unrelated settings revisions without replacing unsaved prices', async () => {
  mount()
  fireEvent.click(await screen.findByRole('button', { name: 'deepseek-official / deepseek-v4-flash' }))
  fireEvent.change(screen.getByRole('textbox', { name: '倍率' }), { target: { value: '3' } })
  const next = snapshot(); next.revision++
  act(() => { eventStream.onmessage?.({ data: JSON.stringify(next) }) })
  expect(screen.queryByText(zh.billingExternalChange)).toBeNull()
  expect(screen.getByRole<HTMLInputElement>('textbox', { name: '倍率' }).value).toBe('3')
  await screen.findByText(zh.billingSaved)
  const sent = JSON.parse(vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === 'PUT')![1]!.body as string)
  expect(sent.expectedRevision).toBe(4)
})

it('allows explicit reload after an invalid autosave without trapping the panel', async () => {
  mount()
  fireEvent.click(await screen.findByRole('button', { name: 'deepseek-official / deepseek-v4-flash' }))
  fireEvent.change(screen.getByRole('textbox', { name: '倍率' }), { target: { value: '-2' } })
  await screen.findByText(zh.billingMultiplierInvalid)
  fireEvent.click(screen.getByRole('button', { name: zh.billingLoadLatest }))
  await waitFor(() => { expect(screen.getByRole<HTMLInputElement>('textbox', { name: '倍率' }).value).toBe('1') })
  expect(screen.getByRole<HTMLButtonElement>('button', { name: zh.close }).disabled).toBe(false)
})

it('searches provider and model names across words without discarding the selected draft', async () => {
  mount(snapshot(), [{ id: 'deepseek-official', name: '深度求索', models: [{ id: 'deepseek-v4-flash', name: 'Flash' }] }, { id: 'other', name: '其他供应商', models: [{ id: 'duplicate', name: 'Flash' }] }])
  fireEvent.click(await screen.findByRole('button', { name: '深度求索 / Flash' }))
  fireEvent.change(screen.getByRole('textbox', { name: '倍率' }), { target: { value: '3' } })
  const search = screen.getByRole('textbox', { name: zh.billingSearch })
  fireEvent.change(search, { target: { value: '  深度求索   FLASH  ' } })
  expect(screen.getByRole('button', { name: '深度求索 / Flash' })).toBeTruthy()
  expect(screen.queryByRole('button', { name: '其他供应商 / Flash' })).toBeNull()
  fireEvent.change(search, { target: { value: 'other duplicate' } })
  expect(screen.queryByRole('button', { name: '深度求索 / Flash' })).toBeNull()
  expect(screen.getByRole('button', { name: '其他供应商 / Flash' })).toBeTruthy()
  expect(screen.getByRole<HTMLInputElement>('textbox', { name: '倍率' }).value).toBe('3')
})

it('persists keyboard column resizing and restores the default ratio', async () => {
  mount()
  const divider = await screen.findByRole('separator', { name: zh.billingSplit })
  expect(divider.getAttribute('aria-valuenow')).toBe('35')
  fireEvent.keyDown(divider, { key: 'ArrowRight' })
  expect(localStorage.getItem('token-monitor.billing.split.v1')).toBe('0.375')
  cleanup(); stopEvents?.(); mount()
  expect(screen.getByRole('separator', { name: zh.billingSplit }).getAttribute('aria-valuenow')).toBe('38')
  fireEvent.click(screen.getByRole('button', { name: zh.billingResetSplit }))
  expect(localStorage.getItem('token-monitor.billing.split.v1')).toBe('0.35')
})

it('saves an independent free cache-write price instead of inheriting input', async () => {
  mount()
  fireEvent.click(await screen.findByRole('button', { name: 'deepseek-official / deepseek-v4-flash' }))
  const input = screen.getByRole<HTMLInputElement>('spinbutton', { name: '人民币 / 百万 Token · 缓存写入' })
  expect(input.disabled).toBe(true)
  expect(input.value).toBe('1')
  fireEvent.change(screen.getByRole('combobox', { name: '人民币 / 百万 Token · 缓存写入计价方式' }), { target: { value: 'independent' } })
  expect(input.disabled).toBe(false)
  fireEvent.change(input, { target: { value: '0' } })
  await screen.findByText(zh.billingSaved)
  const request = vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === 'PUT')![1]!
  expect(JSON.parse(request.body as string).rules.providers[0].models[0].fixed.cacheWrite).toBe(0)
})

it('previews a changed template without saving and applies it only to the draft', async () => {
  const initial = snapshot(), rule = initial.rules.providers[0]!.models[0]!
  rule.source = { templateId: 'deepseek-official/deepseek-v4-flash', name: 'Pricing reference', version: '1', verifiedAt: null, originalCurrency: 'CNY', originalUnit: 'million tokens', conversionBasis: 'none', modified: false }
  const templates = structuredClone(initial.rules)
  templates.providers[0]!.models[0]!.source!.version = '2'
  templates.providers[0]!.models[0]!.fixed.input = 20
  mount(initial, undefined, templates)
  fireEvent.click(await screen.findByRole('button', { name: 'deepseek-official / deepseek-v4-flash' }))
  expect(screen.getByText(zh.billingTemplateChanged)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: zh.billingTemplatePreview }))
  expect(screen.getByText(zh.billingTemplateWarning)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: zh.billingTemplateCancel }))
  expect(screen.getByRole<HTMLInputElement>('spinbutton', { name: '人民币 / 百万 Token · 未缓存输入' }).value).toBe('1')
  fireEvent.click(screen.getByRole('button', { name: zh.billingTemplatePreview }))
  fireEvent.click(screen.getByRole('button', { name: zh.billingTemplateApply }))
  expect(screen.getByRole<HTMLInputElement>('spinbutton', { name: '人民币 / 百万 Token · 未缓存输入' }).value).toBe('20')
  expect(vi.mocked(fetch).mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(false)
  fireEvent.change(screen.getByRole('textbox', { name: '倍率' }), { target: { value: '2' } })
  expect(screen.getByText(new RegExp(zh.billingModified))).toBeTruthy()
  await screen.findByText(zh.billingSaved)
  const request = vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === 'PUT')![1]!
  expect(JSON.parse(request.body as string).rules.providers[0].models[0]).toMatchObject({ multiplier: 2, fixed: { input: 20 }, source: { version: '2', modified: true } })
})

let eventStream: { onmessage?: (event: { data: string }) => void; close: ReturnType<typeof vi.fn> }
beforeEach(() => {
  vi.stubGlobal('EventSource', class {
    onmessage?: (event: { data: string }) => void
    close = vi.fn()
    constructor() {
      // The test driver sends events to the EventSource instance created by the production source.
      // eslint-disable-next-line @typescript-eslint/no-this-alias
      eventStream = this
    }
  })
})

it('displays pushed model price changes in an already open panel and closes its stream', async () => {
  mount()
  await screen.findByRole('button', { name: 'deepseek-official / deepseek-v4-flash' })
  fireEvent.click(screen.getByRole('button', { name: 'deepseek-official / deepseek-v4-flash' }))
  const next = snapshot(); next.revision += 1
  next.rules.providers[0]!.models[0]!.multiplier = 4
  act(() => { eventStream.onmessage?.({ data: JSON.stringify(next) }) })
  expect(screen.getByRole<HTMLInputElement>('textbox', { name: '倍率' }).value).toBe('4')
  cleanup(); stopEvents?.(); expect(eventStream.close).toHaveBeenCalledOnce()
})

it('retains an edited draft until the user explicitly loads pushed rules', async () => {
  mount()
  await screen.findByRole('button', { name: 'deepseek-official / deepseek-v4-flash' })
  fireEvent.click(screen.getByRole('button', { name: 'deepseek-official / deepseek-v4-flash' }))
  fireEvent.change(screen.getByRole('textbox', { name: '倍率' }), { target: { value: '3' } })
  const next = snapshot(); next.revision += 1
  next.rules.providers[0]!.models[0]!.multiplier = 4
  act(() => { eventStream.onmessage?.({ data: JSON.stringify(next) }) })
  expect(screen.getByRole<HTMLInputElement>('textbox', { name: '倍率' }).value).toBe('3')
  expect(screen.getByText(zh.billingExternalChange)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: zh.billingLoadLatest }))
  expect(screen.getByRole<HTMLInputElement>('textbox', { name: '倍率' }).value).toBe('4')
})

afterEach(() => {
  cleanup()
  stopEvents?.()
  stopEvents = undefined
  vi.unstubAllGlobals()
  localStorage.clear()
})

const snapshot = (): BillingSnapshot => ({
  revision: 3,
  rules: {
    version: 1,
    providers: [{ provider: 'deepseek-official', enabled: true, models: [{
      model: 'deepseek-v4-flash', enabled: true, multiplier: 1, mode: 'fixed',
      fixed: { input: 1, cacheHit: 0.1, output: 2 },
      peak: { input: null, cacheHit: null, output: null },
      offPeak: { input: null, cacheHit: null, output: null }, periods: [], tiers: [],
    }] }],
  },
})


const t: DetailTranslate = (key, params) => Object.entries(params ?? {}).reduce<string>((text, [name, value]) => text.replaceAll('{'+name+'}', String(value)), zh[key])

function mount(initial = snapshot(), groups: Array<{ id: string; name?: string; models: Array<{ id: string; name: string }> }> = [
  { id: 'deepseek-official', models: [{ id: 'deepseek-v4-flash', name: 'deepseek-v4-flash' }, { id: 'deepseek-v4-pro', name: 'deepseek-v4-pro' }] },
  { id: 'openai', models: [{ id: 'gpt-5.4', name: 'gpt-5.4' }] },
], templates = initial.rules) {
  let reads = 0
  vi.stubGlobal('fetch', vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => ({ ok: true, json: async () => {
    if (String(_url).endsWith('/templates')) return templates
    if (init?.method === 'PUT') {
      const body = JSON.parse(init.body as string) as { expectedRevision: number; rules: BillingRules }
      return { revision: body.expectedRevision + 1, rules: body.rules }
    }
    reads += 1
    return initial
  } })))
  const loadModelCatalog = vi.fn(async () => ({
    groups,
    failures: [{ id: 'qwen', name: '千问', message: 'unavailable' }],
  }))
  const events = createBillingEvents()
  const panel = () => <BillingRulesPanel t={t} billingEvents={events.getSnapshot()} loadModelCatalog={loadModelCatalog} onClose={vi.fn()} />
  const view = render(panel())
  stopEvents = events.subscribe(() => { view.rerender(panel()) })
  return { loadModelCatalog, getReads: () => reads }
}

it('opens the light supplier card, selects a provider, and closes on outside click', async () => {
  mount()
  await waitFor(() => { expect(screen.getByRole('button', { name: 'deepseek-official / deepseek-v4-pro' })).toBeTruthy() })
  const trigger = screen.getByRole('button', { name: /全部供应商/ })
  expect(trigger.getAttribute('aria-expanded')).toBe('false')
  fireEvent.click(trigger)
  expect(trigger.getAttribute('aria-expanded')).toBe('true')
  expect(screen.getByRole('listbox', { name: '供应商' })).toBeTruthy()
  fireEvent.click(screen.getByRole('option', { name: 'openai' }))
  expect(trigger.textContent).toContain('openai')
  expect(screen.queryByRole('listbox', { name: '供应商' })).toBeNull()
  fireEvent.click(trigger)
  expect(screen.getByRole('listbox', { name: '供应商' })).toBeTruthy()
  fireEvent.pointerDown(document.body)
  expect(screen.queryByRole('listbox', { name: '供应商' })).toBeNull()
  expect(trigger.getAttribute('aria-expanded')).toBe('false')
})

it('shows catalog failures and marks catalog models without rules as unpriced', async () => {
  mount()
  await waitFor(() => { expect(screen.getByText(/gpt-5.4 · 未计价/)).toBeTruthy() })
  expect(screen.getByRole('status').textContent).toContain('千问')
})

it('reloads only the catalog and preserves unsaved billing edits', async () => {
  const { loadModelCatalog, getReads } = mount()
  await waitFor(() => { expect(screen.getByRole('button', { name: 'deepseek-official / deepseek-v4-pro' })).toBeTruthy() })
  fireEvent.click(screen.getByRole('button', { name: 'deepseek-official / deepseek-v4-flash' }))
  fireEvent.change(screen.getByRole('textbox', { name: '倍率' }), { target: { value: '3' } })
  const refresh = screen.getByRole('button', { name: '刷新模型列表' })
  fireEvent.click(refresh)
  await waitFor(() => { expect(loadModelCatalog).toHaveBeenCalledTimes(2) })
  expect(getReads()).toBe(1)
  expect(screen.getByRole<HTMLInputElement>('textbox', { name: '倍率' }).value).toBe('3')
})

it('saves independent provider and model switches', async () => {
  mount()
  fireEvent.click(await screen.findByRole('button', { name: 'deepseek-official / deepseek-v4-flash' }))
  fireEvent.click(screen.getByRole('checkbox', { name: '启用供应商计费' }))
  expect(screen.getByRole<HTMLInputElement>('checkbox', { name: '启用模型计费' }).checked).toBe(true)
  await waitFor(() => { expect(fetch).toHaveBeenCalledWith('/api/token-monitor/billing', expect.objectContaining({ method: 'PUT' })) })
  const request = vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === 'PUT')![1]!
  const provider = (JSON.parse(request.body as string) as { rules: BillingRules }).rules.providers[0]!
  expect(provider.enabled).toBe(false)
  expect(provider.models[0]!.enabled).toBe(true)
})

it.each(['0', '-2', 'NaN', 'Infinity'])('rejects invalid multiplier %s instead of replacing it with one', async (value) => {
  mount()
  fireEvent.click(await screen.findByRole('button', { name: 'deepseek-official / deepseek-v4-flash' }))
  fireEvent.change(screen.getByRole('textbox', { name: '倍率' }), { target: { value } })
  expect((await screen.findByRole('alert')).textContent).toContain('倍率')
  expect(vi.mocked(fetch).mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(false)
})

it('filters failed providers without creating or changing a selected billing rule', async () => {
  mount()
  await screen.findByRole('status')
  fireEvent.click(screen.getByRole('button', { name: /全部供应商/ }))
  fireEvent.click(screen.getByRole('option', { name: 'qwen' }))
  expect(screen.queryByRole('checkbox', { name: '启用供应商计费' })).toBeNull()
  expect(screen.getByText(zh.billingNoModels)).toBeTruthy()
})

it('edits exact provider and model identifiers containing separators', async () => {
  const initial = snapshot()
  initial.rules.providers[0]!.provider = 'vendor|a'
  initial.rules.providers[0]!.models[0]!.model = 'model|b'
  mount(initial, [{ id: 'vendor|a', models: [{ id: 'model|b', name: 'model|b' }] }])
  fireEvent.click(await screen.findByRole('button', { name: 'vendor|a / model|b' }))
  expect(screen.getByRole('heading', { name: 'vendor|a / model|b' })).toBeTruthy()
  fireEvent.change(screen.getByRole('textbox', { name: '倍率' }), { target: { value: '4' } })
  await waitFor(() => { expect(fetch).toHaveBeenCalledWith('/api/token-monitor/billing', expect.objectContaining({ method: 'PUT' })) })
  const request = vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === 'PUT')![1]!
  const provider = (JSON.parse(request.body as string) as { rules: BillingRules }).rules.providers[0]!
  expect(provider.provider).toBe('vendor|a')
  expect(provider.models[0]).toMatchObject({ model: 'model|b', multiplier: 4 })
})

it('lists only selector catalog models while retaining hidden saved rules on save', async () => {
  const initial = snapshot()
  const hidden = structuredClone(initial.rules.providers[0]!)
  hidden.provider = 'retired-provider'
  hidden.models[0]!.model = 'retired-model'
  initial.rules.providers.push(hidden)
  mount(initial, [{ id: 'deepseek-official', models: [{ id: 'deepseek-v4-pro', name: 'DeepSeek Pro' }] }])
  fireEvent.click(await screen.findByRole('button', { name: 'deepseek-official / DeepSeek Pro' }))
  expect(screen.queryByRole('button', { name: 'deepseek-official / deepseek-v4-flash' })).toBeNull()
  expect(screen.queryByRole('button', { name: 'retired-model' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: /全部供应商/ }))
  expect(screen.queryByRole('option', { name: 'retired-provider' })).toBeNull()
  fireEvent.pointerDown(document.body)
  fireEvent.change(screen.getByRole('textbox', { name: '倍率' }), { target: { value: '2' } })
  await waitFor(() => { expect(fetch).toHaveBeenCalledWith('/api/token-monitor/billing', expect.objectContaining({ method: 'PUT' })) })
  const request = vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === 'PUT')![1]!
  const saved = (JSON.parse(request.body as string) as { rules: BillingRules }).rules
  expect(saved.providers).toContainEqual(hidden)
  expect(saved.providers[0]!.models).toContainEqual(initial.rules.providers[0]!.models[0])
})

it('adds a context tier without losing the existing unlimited tier prices and saves both', async () => {
  const initial = snapshot()
  initial.rules.providers[0]!.models[0]!.tiers = [
    { maxInputTokens: 32_000, input: 4, cacheHit: 1, output: 18 },
    { maxInputTokens: null, input: 6, cacheHit: 2, output: 22 },
  ]
  mount(initial)
  fireEvent.click(await screen.findByRole('button', { name: 'deepseek-official / deepseek-v4-flash' }))
  fireEvent.click(screen.getByRole('button', { name: '新增阶梯' }))
  expect(screen.getByRole('spinbutton', { name: '阶梯3 · 未缓存输入' }).getAttribute('value')).toBe('6')
  fireEvent.change(screen.getByRole('spinbutton', { name: '阶梯2 · 最大上下文 Token' }), { target: { value: '64000' } })
  fireEvent.change(screen.getByRole('spinbutton', { name: '阶梯2 · 未缓存输入' }), { target: { value: '5' } })
  await waitFor(() => { expect(fetch).toHaveBeenCalledWith('/api/token-monitor/billing', expect.objectContaining({ method: 'PUT' })) })
  const request = vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === 'PUT')![1]!
  const saved = (JSON.parse(request.body as string) as { rules: BillingRules }).rules.providers[0]!.models[0]!.tiers
  expect(saved).toEqual([
    { maxInputTokens: 32_000, input: 4, cacheHit: 1, output: 18 },
    { maxInputTokens: 64_000, input: 5, cacheHit: 2, output: 22 },
    { maxInputTokens: null, input: 6, cacheHit: 2, output: 22 },
  ])
  fireEvent.click(screen.getByRole('button', { name: '删除阶梯2' }))
  expect(screen.queryByRole('spinbutton', { name: '阶梯3 · 未缓存输入' })).toBeNull()
  expect(screen.getByRole('spinbutton', { name: '阶梯2 · 未缓存输入' }).getAttribute('value')).toBe('6')
})

it('allows adding context tiers to a saved rule that omits the optional tiers field', async () => {
  const initial = snapshot()
  delete initial.rules.providers[0]!.models[0]!.tiers
  mount(initial)
  fireEvent.click(await screen.findByRole('button', { name: 'deepseek-official / deepseek-v4-flash' }))
  fireEvent.click(screen.getByRole('button', { name: '新增阶梯' }))
  expect(screen.getByRole('spinbutton', { name: '阶梯1 · 最大上下文 Token' }).getAttribute('value')).toBe('')
})

it('saves separate period tiers and clock selections automatically without a save button', async () => {
  const initial = snapshot()
  const model = initial.rules.providers[0]!.models[0]!
  model.mode = 'peak'
  model.periods = [{ days: [1], start: 540, end: 720 }]
  model.tiers = [{ maxInputTokens: null, input: 2, cacheHit: 1, output: 6 }]
  mount(initial)
  fireEvent.click(await screen.findByRole('button', { name: 'deepseek-official / deepseek-v4-flash' }))
  expect(screen.queryByRole('button', { name: '保存' })).toBeNull()
  expect(screen.getByRole<HTMLSelectElement>('combobox', { name: '高峰时段1 · 开始时间 · 小时' }).value).toBe('9')
  fireEvent.change(screen.getByRole('combobox', { name: '高峰时段1 · 开始时间 · 小时' }), { target: { value: '8' } })
  fireEvent.change(screen.getByRole('combobox', { name: '高峰时段1 · 开始时间 · 分钟' }), { target: { value: '30' } })
  fireEvent.change(screen.getByRole('combobox', { name: '高峰时段1 · 结束时间 · 小时' }), { target: { value: '24' } })
  expect(screen.getByRole<HTMLSelectElement>('combobox', { name: '高峰时段1 · 结束时间 · 分钟' }).disabled).toBe(true)
  fireEvent.change(screen.getByRole('spinbutton', { name: '高峰 · 阶梯1 · 输出（含推理）' }), { target: { value: '12' } })
  expect(screen.getByRole<HTMLInputElement>('spinbutton', { name: '低谷 · 阶梯1 · 输出（含推理）' }).value).toBe('6')
  fireEvent.change(screen.getByRole('spinbutton', { name: '低谷 · 阶梯1 · 输出（含推理）' }), { target: { value: '3' } })
  await screen.findByText('已保存，仅对新记录生效')
  const request = vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === 'PUT')![1]!
  const saved = (JSON.parse(request.body as string) as { rules: BillingRules }).rules.providers[0]!.models[0]!
  expect(saved.periods).toEqual([{ days: [1], start: 510, end: 1440 }])
  expect(saved.peakTiers?.[0]?.output).toBe(12)
  expect(saved.offPeakTiers?.[0]?.output).toBe(3)
  expect(saved.tiers?.[0]?.output).toBe(6)
})
