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
let stream: ReadableStreamDefaultReader<Uint8Array> | undefined
afterEach(async () => {
  await stream?.cancel(); stream = undefined
  await context?.fiber.dispose(); context = undefined
  vi.unstubAllEnvs()
  if (root) await rm(root, { recursive: true, force: true })
})

class BillingAdapter extends MockAdapter {
  override listModels(provider: string) { return Promise.resolve([{ provider, id: 'test-model', name: 'Test model' }]) }
}

async function boot(adapter: BillingAdapter) {
  root ??= await mkdtemp(join(tmpdir(), 'dsh-billing-loader-'))
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
    ['adapter', { name: 'billing-test-adapter', inject: ['llm'], apply(ctx: Context) { ctx.llm.registerAdapter(['billing-test'], adapter) } }],
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
  return { ctx, url }
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
  expect(templates.providers.map((provider: { provider: string }) => provider.provider)).toEqual(['deepseek-official', 'deepseek-account', 'openai', 'zhipu', 'kimi'])
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
