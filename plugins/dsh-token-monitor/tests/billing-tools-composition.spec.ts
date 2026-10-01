/** Real app-boot composition: model tool calls, plugin-owned state and HTTP live snapshots. */
import { cp, mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import ConfigEditor from '@deepseek-ai/dsh-config-editor'
import Settings from '@deepseek-ai/dsh-settings'
import { initProfile, readProfilePatches, type ProfileContext } from '@deepseek-ai/dsh-app-boot'
import Credentials from '@deepseek-ai/dsh-credentials-local'
import Llm, { createUserMessage, ToolCallId, ReasoningEffortId, type StreamChunk } from '@deepseek-ai/dsh-llm'
import Tools from '@deepseek-ai/dsh-tools'
import Sessions, { SessionId } from '@deepseek-ai/dsh-session'
import Projections from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import Agents from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import { MockAdapter, textResponse, toolCallResponse } from './mock-adapter.ts'
import type { BillingSnapshot, ModuleReleaseManifest } from '@deepseek-ai/dsh-token-monitor-contract'
import { apply as applyRuntime, type RuntimeOptions } from '../src/runtime-host.ts'

let context: Context | undefined
let root: string | undefined
const createdRoots: string[] = []
let stream: ReadableStreamDefaultReader<Uint8Array> | undefined

/** 释放当前组合：先停 SSE 读取，再销毁 cordis 上下文；目录留给调用方检查。 */
async function shutdown() {
  await stream?.cancel().catch(() => {}); stream = undefined
  await context?.fiber.dispose(); context = undefined
}

afterEach(async () => {
  await shutdown()
  vi.unstubAllEnvs()
  // 每个用例自己创建的临时 home 都在这里统一回收，不跨用例复用同一路径。
  for (const dir of createdRoots.splice(0)) await rm(dir, { recursive: true, force: true })
  root = undefined
})

class BillingAdapter extends MockAdapter {
  private readonly catalogs: Record<string, string[]>
  private readonly failing: string[]
  constructor(responses: ConstructorParameters<typeof MockAdapter>[0], options?: ConstructorParameters<typeof MockAdapter>[1], catalogs: Record<string, string[]> = {}, failing: string[] = []) {
    super(responses, options)
    this.catalogs = catalogs
    this.failing = failing
  }
  override listModels(provider: string) {
    if (this.failing.includes(provider)) return Promise.reject(new Error('Model catalog unavailable'))
    return Promise.resolve((this.catalogs[provider] ?? ['test-model']).map(id => ({ provider, id, name: id })))
  }
}

/** 官方族路由与账号路由都属于官方族，计费资格同源。 */
const deepseekCatalogs = { 'deepseek-official': ['deepseek-v4-pro'], 'deepseek-account': ['deepseek-v4-pro'] }

/**
 * 启动真实应用组合。默认复用当前临时 home（重启保持场景），`fresh` 则新建一个隔离根，
 * 使同一用例内重复启动也能各自持有独立目录与状态。
 */
async function boot(adapter: BillingAdapter, options: { fresh?: boolean } = {}) {
  // A repeated boot in one test must release the previous loader/app tree before
  // replacing the shared context reference, otherwise the old web server and
  // plugin effects remain alive against its temporary home.
  if (context) await shutdown()
  if (options.fresh === true || root === undefined) {
    root = await mkdtemp(join(tmpdir(), 'dsh-billing-loader-'))
    createdRoots.push(root)
  }
  vi.stubEnv('DSH_HOME', root)
  vi.stubEnv('DEEPSEEK_API_KEY', '')
  // 已构建的发布树整体拷进临时 home：模块生命周期测试会真的删除载荷文件，
  // 因此每次启动都必须从只读的发布源重新铺设，不能就地消费构建输出。
  const release = process.env['DSH_TOKEN_MONITOR_RELEASE'] ?? resolve(dirname(fileURLToPath(import.meta.url)), '../../../runtime')
  const runtime = join(root, 'runtime')
  await rm(runtime, { recursive: true, force: true })
  await cp(release, runtime, { recursive: true })
  const manifest = JSON.parse(await readFile(join(runtime, 'manifest.json'), 'utf8')) as ModuleReleaseManifest
  const roots = { host: join(runtime, 'host'), client: join(runtime, 'client'), assets: join(runtime, 'assets') }
  // 设置面板与 ctx.settings 都来自真实的应用组合：profile patch 里的 settings 条目
  // 就是用户写配置的那一行，插件自己的行则在 per-profile 用户层，与生产安装层次一致。
  const dir = join(root, 'profiles', 'test')
  initProfile(dir, [])
  const patchPath = join(dir, 'cordis.patch.yml')
  const dataDir = join(root, 'data/dsh-token-monitor')
  await mkdir(dataDir, { recursive: true })
  const profile: ProfileContext = {
    name: 'test', startedBundles: [], dir, patchPath, installAnchor: join(root, 'package.json'),
    cwd: root, home: root, overlays: [], telemetryDisabledEnv: undefined,
  }
  await writeFile(patchPath, JSON.stringify([{ insert: [
    { id: 'config-editor', name: 'editor' },
    { id: 'settings', name: 'settings' },
  ] }]))
  const ctx = context = new Context()
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  // `cordis:include` is a builtin the host registers before mounting the root
  // include; without it the entry resolves to `undefined` and the whole tree
  // fails to import.
  Object.assign(ctx.loader.builtins, { include: Include })
  const modules = new Map<string, unknown>([
    ['editor', ConfigEditor], ['settings', Settings],
    ['credentials', Credentials], ['llm', Llm],
    ['tools', Tools], ['sessions', Sessions], ['projections', Projections],
    ['prompt', SystemPrompt], ['agents', Agents], ['loop', AgentLoop],
    ['web', WebServer],
    ['monitor', { name: 'dsh-token-monitor', inject: ['sessions', 'credentials', 'settings'], apply: (scope: Context) => applyRuntime(scope, {
      roots, stateFile: join(runtime, 'state.json'), manifest, dataDir,
    } as RuntimeOptions) }],
    ['adapter', { name: 'billing-test-adapter', inject: ['llm'], apply(ctx: Context) { ctx.llm.registerAdapter(['billing-test', 'deepseek-official', 'deepseek-account'], adapter) } }],
    ['trust', { name: 'billing-test-trust', apply(ctx: Context) { ctx.provide('connection', { requestRejection: () => undefined }) } }],
  ])
  ctx.loader.internal = { version: 'v2', async import(name: string) {    if (!modules.has(name)) throw new Error('Unexpected module: ' + name)
    return modules.get(name)
  } } as NonNullable<typeof ctx.loader.internal>
  const config = [
    { name: 'credentials', config: { path: join(root, 'credentials.yaml'), watch: false } },
    { name: 'llm' }, { name: 'tools', config: { mode: 'native' } }, { name: 'sessions' },
    { name: 'projections' }, { name: 'prompt', config: { personaPrefix: '' } },
    { name: 'agents' }, { name: 'loop', config: { agents: [] } },
      { name: 'web', config: { host: '127.0.0.1', port: 0 } }, { name: 'adapter' }, { name: 'trust' }, { name: 'monitor' },
  ].map((entry, i) => ({ id: 'test-' + i, ...entry }))
  const path = join(root, 'cordis.yml')
  await writeFile(path, JSON.stringify(config))
  ctx.provide('profileContext', profile)
  ctx.provide('appReady', { onReady: (listener: () => void) => { listener(); return () => {} } })
  await ctx.loader.create({ id: 'include', name: 'cordis:include',
    config: { path: pathToFileURL(path).href, patches: readProfilePatches('test', profile) } })
  await ctx.loader.await()
  const url = 'http://127.0.0.1:' + ctx.webServer.port
  await vi.waitFor(async () => expect((await fetch(url + '/api/token-monitor/billing')).status).toBe(200))
  return { ctx, url, root }
}

const updateName = 'token_monitor_billing_update'
const getName = 'token_monitor_billing_get'
async function call(ctx: Context, name: string, args: Record<string, unknown>) {
  return ctx.tools.execute({ name, arguments: args, callId: ToolCallId('test'), signal: new AbortController().signal })
}
function paid(chunks: StreamChunk[]): StreamChunk[] {
  return chunks.map(chunk => chunk.type === 'usage' ? { type: 'usage', usage: { inputTokens: 1_000_000, outputTokens: 0 } } : chunk)
}
async function snapshot(url: string): Promise<BillingSnapshot> {
  return (await fetch(url + '/api/token-monitor/billing')).json()
}
async function nextEvent(): Promise<BillingSnapshot> {
  let text = ''
  while (!text.includes('\n\n')) {
    const result = await stream!.read()
    if (result.done) throw new Error('SSE ended before snapshot')
    text += new TextDecoder().decode(result.value)
  }
  return JSON.parse(text.trim().replace(/^data: /, ''))
}

it('loads production plugin, changes prices through real agent tools, pushes rules and preserves costs across reload', async () => {
  let revision = 0
  const adapter = new BillingAdapter([
    paid(textResponse('First charge')),
    toolCallResponse('read', getName, {}),
    () => toolCallResponse('update', updateName, { provider: 'billing-test', model: 'test-model', expectedRevision: revision,
      patch: { multiplier: 3, fixed: { input: 10, cacheWrite: 7 } } }),
    paid(textResponse('Rule saved')),
  ], { efforts: [{ id: ReasoningEffortId('high'), name: 'High' }], defaultEffort: ReasoningEffortId('high') })
  const { ctx, url } = await boot(adapter)
  const templates = await (await fetch(url + '/api/token-monitor/billing/templates')).json()
  expect(templates.providers.map((provider: { provider: string }) => provider.provider)).toEqual(['deepseek-official', 'openai', 'zhipu', 'kimi'])
  expect((await fetch(url + '/api/token-monitor/billing/templates', { method: 'PUT' })).status).toBe(405)
  const initial = await snapshot(url)
  const configured = await call(ctx, updateName, { provider: 'billing-test', model: 'test-model', expectedRevision: initial.revision,
    providerEnabled: true, patch: { enabled: true, multiplier: 2, fixed: { input: 5, cacheHit: 1, output: 2 } } })
  expect(configured.isError, JSON.stringify(configured)).not.toBe(true)
  revision = (await snapshot(url)).revision
  const response = await fetch(url + '/api/token-monitor/billing/events')
  expect(response.headers.get('content-type')).toBe('text/event-stream')
  stream = response.body!.getReader()
  expect((await nextEvent()).revision).toBe(revision)
  const agent = await ctx.agentLoop.create(SessionId('billing-tools'), { provider: 'billing-test', model: 'test-model' })
  const turn = async (text: string) => {
    const idle = new Promise<void>(resolve => {
      const dispose = ctx.on('agent/status', ({ agent: current, status }) => {
        if (current === agent && status === 'idle') { dispose(); resolve() }
      })
    })
    agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
    await idle
  }
  await turn('Record usage')
  let records = await (await fetch(url + '/api/token-monitor/usage')).json()
  expect(records).toHaveLength(1)
  expect(records[0].cost).toBe(10)
  await turn('Change input price to 10 and multiplier to 3')
  const event = await nextEvent()
  const saved = await snapshot(url)
  expect(event).toEqual(saved)
  expect(saved.revision).toBeGreaterThan(revision)
  const rule = saved.rules.providers.find(p => p.provider === 'billing-test')!.models[0]!
  expect(rule.fixed).toEqual({ input: 10, cacheHit: 1, output: 2, cacheWrite: 7 })
  expect(rule.multiplier).toBe(3)
  records = await (await fetch(url + '/api/token-monitor/usage')).json()
  expect(records[0].cost).toBe(10)
  expect(records.at(-1).cost).toBe(30)
  expect(records.at(-1).billingApplied.rate.cacheWrite).toBe(7)
  expect(adapter.requests).toHaveLength(4)
  expect(adapter.requests.every(request => request.reasoningEffort === 'high')).toBe(true)
  const detailsFile = await readFile(join(root!, 'data/dsh-token-monitor/request-details.jsonl'), 'utf8')
  const attempts = detailsFile.trim().split('\n').map(line => JSON.parse(line)).filter(record => record.kind === 'attempt')
  expect(attempts.length).toBeGreaterThanOrEqual(4)
  expect(attempts.every(record => record.value.reasoningEffort === 'high')).toBe(true)
  expect(adapter.requests[1]!.tools?.some(tool => tool.name === updateName)).toBe(true)
  const results = agent.session.snapshotEvents().filter(event => event.type === 'tool/result')
  expect(results.length).toBe(2)
  expect(JSON.stringify(results)).toContain('historicalCostsChanged')
  expect(ctx.tools.schemas().filter(tool => [getName, updateName].includes(tool.name))).toMatchSnapshot('model-visible billing tools')
  const read = await call(ctx, getName, { provider: 'billing-test' })
  expect(read.value).toMatchSnapshot('model-visible saved billing rule')
  const unchanged = JSON.stringify(saved)
  for (const args of [
    { expectedRevision: revision, patch: { multiplier: 4 } },
    { expectedRevision: saved.revision, patch: { multiplier: -1 } },
    { expectedRevision: saved.revision, model: 'unavailable', patch: { multiplier: 4 } },
    { expectedRevision: saved.revision, patch: { fixed: { input: -1 } } },
  ]) {
    const result = await call(ctx, updateName, { provider: 'billing-test', model: 'test-model', ...args })
    expect(result.isError).toBe(true)
    expect(JSON.stringify(await snapshot(url))).toBe(unchanged)
  }
  const file = JSON.parse(await readFile(join(root!, 'data/dsh-token-monitor/state.json'), 'utf8')) as { billing: { providers: Array<{ models: Array<{ multiplier: number }> }> } }
  expect(file.billing.providers.some(provider => provider.models.some(model => model.multiplier === 3))).toBe(true)
  await stream.cancel(); stream = undefined
  await ctx.fiber.dispose(); context = undefined
  const restored = await boot(new BillingAdapter([]))
  expect((await snapshot(restored.url)).rules).toEqual(saved.rules)
  expect(await (await fetch(restored.url + '/api/token-monitor/usage')).json()).toEqual(records)
}, 30_000)

/** 工具返回值的形状：`{ value: { groups: [...] } }`。 */
interface ToolGroup { provider: string; enabled?: boolean; ruleProvider?: string | null; ruleSource?: string; models?: Array<{ model: string; hasRule?: boolean; rule?: Record<string, unknown> }> }
interface ToolValue { groups?: ToolGroup[] }
/** 传入工具的 `read.value`（已是解包后的对象）。 */
const groupOf = (value: unknown) => (value as ToolValue)?.groups?.[0] ?? ({} as ToolGroup)
const ruleOf = (value: unknown, model?: string) => (model === undefined ? groupOf(value).models?.[0] : groupOf(value).models?.find(item => item.model === model))?.rule ?? {}
const hasRuleOf = (value: unknown, model: string) => groupOf(value).models?.find(item => item.model === model)?.hasRule

/** 通过设置接口整体写入规则；账号独立条目只能由这条路径建立，更新工具本身会拒绝继承写入。 */
async function putRules(url: string, revision: number, rules: unknown): Promise<number> {
  const response = await fetch(url + '/api/token-monitor/billing', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedRevision: revision, rules }) })
  return response.status
}

/** 把官方共享规则整条复制成账号独立条目，再补一条官方没有的兄弟模型。 */
function accountCopyWithSibling(rules: BillingSnapshot['rules']) {
  const official = structuredClone(rules.providers.find(item => item.provider === 'deepseek-official')!)
  const account = { ...official, provider: 'deepseek-account' }
  const sibling = structuredClone(account.models.find(model => model.model === 'deepseek-v4-pro')!)
  account.models.push({ ...sibling, model: 'deepseek-v4-sibling' })
  return { ...rules, providers: [...rules.providers, account] }
}

/** 真实宿主采集链：一次会话调用产生一条 usage 账本记录。 */
async function chargeOnce(ctx: Context, url: string, provider: string, model: string, session: string) {
  const agent = await ctx.agentLoop.create(SessionId(session), { provider, model })
  const idle = new Promise<void>(resolve => {
    const off = ctx.on('agent/status', ({ agent: current, status }) => { if (current === agent && status === 'idle') { off(); resolve() } })
  })
  agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Charge' }], source: { kind: 'user' } }))
  await idle
  return (await (await fetch(url + '/api/token-monitor/usage')).json()) as Array<Record<string, unknown>>
}

it('T1/T8: inherits the official rule for the account route, prices it, and stays read-only', async () => {
  const { ctx, url } = await boot(new BillingAdapter([paid(textResponse('Inherited charge'))], undefined, deepseekCatalogs))
  const initial = await snapshot(url)
  const deterministicRules = structuredClone(initial.rules)
  const officialRule = deterministicRules.providers.find(provider => provider.provider === 'deepseek-official')!.models.find(model => model.model === 'deepseek-v4-pro')!
  Object.assign(officialRule, { mode: 'fixed', fixed: { input: 4, cacheHit: null, cacheWrite: null, output: null }, tiers: [], peakTiers: [], offPeakTiers: [] })
  expect(await putRules(url, initial.revision, deterministicRules)).toBe(200)
  const before = await snapshot(url)
  expect(before.rules.providers.some(p => p.provider === 'deepseek-account')).toBe(false)
  const read = await call(ctx, getName, { provider: 'deepseek-account' })
  expect(read.isError, JSON.stringify(read)).not.toBe(true)
  expect(groupOf(read.value), JSON.stringify(read.value)).toMatchObject({ provider: 'deepseek-account', ruleProvider: 'deepseek-official', ruleSource: 'official-family', enabled: true })
  expect(hasRuleOf(read.value, 'deepseek-v4-pro')).toBe(true)
  expect(ruleOf(read.value)).toMatchObject({ model: 'deepseek-v4-pro', mode: 'fixed' })
  const named = groupOf((await call(ctx, getName, { provider: 'deepseek-official' })).value)
  expect(named).toMatchObject({ ruleProvider: 'deepseek-official', ruleSource: 'explicit' })
  // 实际计费同样走继承规则：1,000,000 输入、0 输出，规则固定为 4 元/百万。
  const records = await chargeOnce(ctx, url, 'deepseek-account', 'deepseek-v4-pro', 'inherited-account')
  expect(records).toHaveLength(1)
  expect(records[0]).toMatchObject({ provider: 'deepseek-account', model: 'deepseek-v4-pro', billingStatus: 'priced' })
  // 手算：1,000,000 输入 × 4 元/百万 = 恰好 4 元；无输出及缓存费用。
  expect(records[0]).toMatchObject({ inputTokens: 1_000_000, outputTokens: 0, cost: 4 })
  // T8 只读：查询前后规则、provider 列表和持久配置完全一致。
  expect((await snapshot(url)).rules.providers).toEqual(before.rules.providers)
  const state = JSON.parse(await readFile(join(root!, 'data/dsh-token-monitor/state.json'), 'utf8').catch(() => '{}')) as { billing?: { providers: Array<{ provider: string }> } }
  expect(state.billing?.providers.some(p => p.provider === 'deepseek-account') ?? false).toBe(false)
}, 30_000)

it('T5: reports hasRule false when the explicit account entry lacks the model', async () => {
  // 账号路由的目录里同时列出它自己的兄弟模型，用来区分“条目自带模型”和“借用官方模型”。
  const { ctx, url } = await boot(new BillingAdapter([], undefined, { 'deepseek-official': ['deepseek-v4-pro'], 'deepseek-account': ['deepseek-v4-pro', 'deepseek-v4-sibling'] }))
  const official = await snapshot(url)
  const source = structuredClone(official.rules.providers.find(item => item.provider === 'deepseek-official')!)
  // 官方共享条目确实带有该模型；显式账号条目故意缺它，只留一个官方没有的兄弟模型。
  expect(source.models.some(model => model.model === 'deepseek-v4-pro')).toBe(true)
  const account = { ...source, provider: 'deepseek-account',
    models: source.models.filter(model => model.model !== 'deepseek-v4-pro').concat({ ...source.models[0]!, model: 'deepseek-v4-sibling' }) }
  expect(await putRules(url, official.revision, { ...official.rules, providers: [...official.rules.providers, account] })).toBe(200)
  const read = await call(ctx, getName, { provider: 'deepseek-account' })
  expect(groupOf(read.value), JSON.stringify(read.value)).toMatchObject({ ruleProvider: 'deepseek-account', ruleSource: 'explicit', enabled: true })
  // 显式条目整体优先：它缺的模型保持缺规则，不逐模型回退到官方共享条目。
  expect(hasRuleOf(read.value, 'deepseek-v4-pro')).toBe(false)
  expect(hasRuleOf((await call(ctx, getName, { provider: 'deepseek-official' })).value, 'deepseek-v4-pro')).toBe(true)
  expect(ruleOf(read.value, 'deepseek-v4-pro')).toMatchObject({ model: 'deepseek-v4-pro', fixed: { input: null, cacheHit: null, output: null } })
  expect(ruleOf(read.value, 'deepseek-v4-pro').peak).toEqual({ input: null, cacheHit: null, output: null })
  expect(hasRuleOf(read.value, 'deepseek-v4-sibling')).toBe(true)
  expect(ruleOf(read.value, 'deepseek-v4-sibling')).toMatchObject({ model: 'deepseek-v4-sibling' })
  expect(typeof (ruleOf(read.value, 'deepseek-v4-sibling').peak as { input?: unknown }).input).toBe('number')
}, 30_000)

it('T5: keeps each boot() in an isolated home and releases the previous context', async () => {
  const first = await boot(new BillingAdapter([], undefined, deepseekCatalogs))
  expect(await putRules(first.url, (await snapshot(first.url)).revision, accountCopyWithSibling((await snapshot(first.url)).rules))).toBe(200)
  expect((await snapshot(first.url)).rules.providers.some(provider => provider.provider === 'deepseek-account')).toBe(true)
  // 同一用例内重复启动：第二个组合必须拿到全新的隔离根，不能复用上一个目录。
  const second = await boot(new BillingAdapter([], undefined, deepseekCatalogs), { fresh: true })
  expect(second.root).not.toBe(first.root)
  expect((await snapshot(second.url)).rules.providers.some(provider => provider.provider === 'deepseek-account')).toBe(false)
  expect(hasRuleOf((await call(second.ctx, getName, { provider: 'deepseek-account' })).value, 'deepseek-v4-pro')).toBe(true)
  // 释放上一段组合后，新组合仍然独立可用（上下文与目录都被隔离）。
  await shutdown()
  const third = await boot(new BillingAdapter([], undefined, deepseekCatalogs), { fresh: true })
  expect(third.root).not.toBe(second.root)
  expect((await snapshot(third.url)).rules.providers.some(provider => provider.provider === 'deepseek-account')).toBe(false)
}, 30_000)

it('T9/T10: refuses to shadow inherited account rules and writes nothing', async () => {
  const { ctx, url } = await boot(new BillingAdapter([], undefined, deepseekCatalogs))
  const before = await snapshot(url)
  const ledger = join(root!, 'data/dsh-token-monitor/state.json')
  const stored = await readFile(ledger, 'utf8').catch(() => '')
  const cases: Array<Record<string, unknown>> = [
    { patch: { multiplier: 2 } },
    { patch: { enabled: true }, providerEnabled: true },
    { patch: { enabled: false, fixed: { input: 1 } } },
  ]
  for (const args of cases) {
    const result = await call(ctx, updateName, { provider: 'deepseek-account', model: 'deepseek-v4-pro', expectedRevision: before.revision, ...args })
    expect(result.isError, JSON.stringify(result)).toBe(true)
    expect(JSON.stringify(result.content)).toContain('INHERITED_BILLING_RULES')
    expect(JSON.stringify(result.content)).toContain('deepseek-official')
  }
  // 零写入：规则、revision、持久文件都不变。
  expect(await snapshot(url)).toEqual(before)
  expect(await readFile(ledger, 'utf8').catch(() => '')).toBe(stored)
}, 30_000)

it('T11/T12/T15: keeps sibling fields on explicit updates, defaults new providers to disabled, and survives restart', async () => {
  const { ctx, url } = await boot(new BillingAdapter([], undefined, deepseekCatalogs))
  const initial = await snapshot(url)
  // 账号独立条目由用户配置路径建立；随后局部改价不得扩散。
  expect(await putRules(url, initial.revision, accountCopyWithSibling(initial.rules))).toBe(200)
  const base = await snapshot(url)
  const updated = await call(ctx, updateName, { provider: 'deepseek-account', model: 'deepseek-v4-pro', expectedRevision: base.revision, patch: { multiplier: 9 } })
  expect(updated.isError, JSON.stringify(updated)).not.toBe(true)
  const saved = await snapshot(url)
  const savedAccount = saved.rules.providers.find(p => p.provider === 'deepseek-account')!
  const pro = savedAccount.models.find(m => m.model === 'deepseek-v4-pro')!
  expect(pro.multiplier).toBe(9)
  // 未指定的嵌套价格字段、兄弟模型和其它 provider 都不变。
  expect(pro.fixed).toEqual(savedAccount.models.find(m => m.model === 'deepseek-v4-sibling')!.fixed)
  expect(savedAccount.models.find(m => m.model === 'deepseek-v4-sibling')!.multiplier).toBe(1)
  expect(savedAccount.enabled).toBe(true)
  expect(saved.rules.providers.find(p => p.provider === 'deepseek-official')!.models[0]!.fixed).toEqual(initial.rules.providers.find(p => p.provider === 'deepseek-official')!.models[0]!.fixed)
  // T12：全新的非继承 provider 保持默认关闭。
  const brandNew = await call(ctx, updateName, { provider: 'billing-test', model: 'test-model', expectedRevision: (await snapshot(url)).revision, patch: { multiplier: 2 } })
  expect(brandNew.isError, JSON.stringify(brandNew)).not.toBe(true)
  expect((await snapshot(url)).rules.providers.find(p => p.provider === 'billing-test')!.enabled).toBe(false)
  // T15：重启后规则与 revision 保持，历史费用不重算。
  const revision = (await snapshot(url)).revision
  const rules = (await snapshot(url)).rules
  await stream?.cancel(); stream = undefined
  await ctx.fiber.dispose(); context = undefined
  const restored = await boot(new BillingAdapter([]))
  const afterRestart = await snapshot(restored.url)
  expect(afterRestart.revision).toBe(revision)
  expect(afterRestart.rules.providers).toEqual(rules.providers)
}, 30_000)

it('T13/T14: rejects revision, price and model failures with no partial save; catalog errors stay visible', async () => {
  const { ctx, url } = await boot(new BillingAdapter([], undefined, deepseekCatalogs))
  const initial = await snapshot(url)
  expect(await putRules(url, initial.revision, accountCopyWithSibling(initial.rules))).toBe(200)
  const current = await snapshot(url)
  const before = JSON.stringify(current)
  const cases: Array<{ expectedRevision: number; model: string; args: Record<string, unknown> }> = [
    { expectedRevision: 0, model: 'deepseek-v4-pro', args: { patch: { multiplier: 3 } } },
    { expectedRevision: current.revision, model: 'deepseek-v4-pro', args: { patch: { multiplier: -1 } } },
    { expectedRevision: current.revision, model: 'deepseek-v4-pro', args: { patch: { fixed: { input: -1 } } } },
    { expectedRevision: current.revision, model: 'unavailable', args: { patch: { multiplier: 3 } } },
  ]
  for (const item of cases) {
    const result = await call(ctx, updateName, { provider: 'deepseek-account', model: item.model, expectedRevision: item.expectedRevision, ...item.args })
    expect(result.isError, JSON.stringify(result)).toBe(true)
    expect(JSON.stringify(await snapshot(url))).toBe(before)
  }
  // T14：目录服务异常必须显式保留，既不伪装成正常查询，也不允许继续写入。
  const broken = await boot(new BillingAdapter([], undefined, deepseekCatalogs, ['deepseek-account']))
  const read = await call(broken.ctx, getName, { provider: 'deepseek-account' })
  expect(JSON.stringify(read.value)).toContain('Model catalog unavailable')
  const brokenBefore = JSON.stringify(await snapshot(broken.url))
  const blocked = await call(broken.ctx, updateName, { provider: 'deepseek-account', model: 'deepseek-v4-pro', expectedRevision: (await snapshot(broken.url)).revision, patch: { multiplier: 2 } })
  expect(blocked.isError, JSON.stringify(blocked)).toBe(true)
  expect(JSON.stringify(await snapshot(broken.url))).toBe(brokenBefore)
}, 30_000)

it('T16: prices an in-flight request with the rule captured before a mid-flight price change', async () => {
  // 可控暂停点：请求开始后、结束前改价。适配器把 usage 之后的每一块挂起，
  // 测试据此在请求仍在进行时改写规则，再放行结束。
  // `reached` 由适配器在交付 usage 分片时兑现（说明请求已进入进行中且快照已冻结）；
  // `gate` 由用例放行，使同一请求在改价之后才结束。
  let reached: (() => void) | undefined
  const midFlight = new Promise<void>(resolve => { reached = resolve })
  let release: (() => void) | undefined
  const gate = new Promise<void>(resolve => { release = resolve })
  const adapter = new BillingAdapter([paid(textResponse('Rule frozen')), paid(textResponse('Rule refreshed'))],
    { onChunk: chunk => { if (chunk.type !== 'usage') return; reached!(); return gate } }, deepseekCatalogs)
  const { ctx, url } = await boot(adapter)
  const initial = await snapshot(url)
  // 只用夹具价格：官方共享条目固定价输入 4 元/百万，输出与缓存留空以便断言只计输入。
  expect(await putRules(url, initial.revision, { ...initial.rules, providers: initial.rules.providers.map(p => p.provider !== 'deepseek-official' ? p : {
    ...p, models: p.models.map(m => m.model !== 'deepseek-v4-pro' ? m : { ...m, mode: 'fixed', fixed: { input: 4, cacheHit: null, cacheWrite: null, output: null }, tiers: [], peakTiers: [], offPeakTiers: [] }),
  }) })).toBe(200)
  const frozenRevision = (await snapshot(url)).revision
  const ledger = join(root!, 'data/dsh-token-monitor/usage.jsonl')
  const records = async () => (await readFile(ledger, 'utf8')).trim().split('\n').map(line => JSON.parse(line))
  const agent = await ctx.agentLoop.create(SessionId('frozen-rules'), { provider: 'deepseek-official', model: 'deepseek-v4-pro' })
  const idle = new Promise<void>(resolve => { const off = ctx.on('agent/status', ({ agent: current, status }) => { if (current === agent && status === 'idle') { off(); resolve() } }) })
  agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Freeze the rule' }], source: { kind: 'user' } }))
  await midFlight
  // 请求尚未结束：此刻改价，必须只影响之后的请求。
  const inFlight = await snapshot(url)
  expect(await putRules(url, inFlight.revision, { ...inFlight.rules, providers: inFlight.rules.providers.map(p => p.provider !== 'deepseek-official' ? p : {
    ...p, models: p.models.map(m => m.model !== 'deepseek-v4-pro' ? m : { ...m, fixed: { ...m.fixed, input: 40 } }),
  }) })).toBe(200)
  const newRevision = (await snapshot(url)).revision
  expect(newRevision).toBeGreaterThan(frozenRevision)
  expect(await records().catch(() => [])).toHaveLength(0)
  release!()
  await idle
  const captured = await records()
  expect(captured).toHaveLength(1)
  // 进行中的请求沿用捕获时的 4 元规则；billingRuleVersion 是冻结时的 revision。
  expect(captured[0]).toMatchObject({ provider: 'deepseek-official', model: 'deepseek-v4-pro', inputTokens: 1_000_000, outputTokens: 0, cost: 4, billingStatus: 'priced', billingRuleVersion: frozenRevision })
  expect(captured[0].billingApplied.rate.input).toBe(4)
  // 之后的请求使用新价 40 元/百万。
  const second = await chargeOnce(ctx, url, 'deepseek-official', 'deepseek-v4-pro', 'frozen-rules-2')
  expect(second.at(-1)).toMatchObject({ cost: 40, billingStatus: 'priced', billingRuleVersion: newRevision })
  // 历史记录不被重算。
  expect((await records())[0]).toMatchObject({ cost: 4, billingRuleVersion: frozenRevision })
}, 30_000)

it('physically uninstalls billing and overview while capture continues, then stops capture on whole removal', async () => {
  const { ctx, url } = await boot(new BillingAdapter(Array.from({ length: 4 }, () => paid(textResponse('Usage')))))
  const initial = await snapshot(url)
  await call(ctx, updateName, { provider: 'billing-test', model: 'test-model', expectedRevision: initial.revision,
    providerEnabled: true, patch: { enabled: true, fixed: { input: 5, cacheHit: 1, output: 2 } } })
  const agent = await ctx.agentLoop.create(SessionId('module-lifetimes'), { provider: 'billing-test', model: 'test-model' })
  const turn = async () => {
    const idle = new Promise<void>(resolve => {
      const off = ctx.on('agent/status', ({ agent: current, status }) => { if (current === agent && status === 'idle') { off(); resolve() } })
    })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Record' }], source: { kind: 'user' } }))
    await idle
  }
  const remove = async (ids: string[], wholePlugin = false) => {
    const state = await (await fetch(url + '/api/token-monitor/modules')).json()
    const result = await fetch(url + '/api/token-monitor/modules/uninstall', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids, wholePlugin, preserveData: true, expectedRevision: state.revision }) })
    expect(result.status).toBe(200)
    return result.json()
  }
  const ledger = join(root!, 'data/dsh-token-monitor/usage.jsonl')
  const records = async () => (await readFile(ledger, 'utf8')).trim().split('\n').map(line => JSON.parse(line))
  await turn()
  expect((await records())[0].cost).toBe(5)
  const billingRemoved = await remove(['billing'])
  expect(billingRemoved.modules.find((m: { id: string }) => m.id === 'billing').status).toBe('removed')
  await expect(readFile(join(root!, 'runtime/host/billing.mjs'))).rejects.toMatchObject({ code: 'ENOENT' })
  expect((await fetch(url + '/api/token-monitor/billing')).status).toBe(404)
  expect(ctx.tools.schemas().some(tool => tool.name === updateName)).toBe(false)
  await turn()
  expect(await records()).toHaveLength(2)
  expect((await records())[1]).toMatchObject({ cost: 0, billingStatus: 'unpriced', inputTokens: 1_000_000 })
  await remove(['overview'])
  expect((await fetch(url + '/api/token-monitor/usage')).status).toBe(404)
  await turn()
  expect(await records()).toHaveLength(3)
  expect(await remove([], true)).toMatchObject({ pluginRemoved: true })
  await turn()
  expect(await records()).toHaveLength(3)
  await expect(readFile(join(root!, 'runtime/host/core.mjs'))).rejects.toMatchObject({ code: 'ENOENT' })
}, 30_000)
