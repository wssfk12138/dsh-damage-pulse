/** Token Monitor 的 Host 设置接口：真实 profile patch、Loader 与 HTTP 契约。 */
import { createServer, type Server } from 'node:http'
import { readFile, writeFile } from 'node:fs/promises'
import { mkdirSync } from 'node:fs'
import { AddressInfo } from 'node:net'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import type { Context } from '@deepseek-ai/cordis'
import { configurationFixture } from './fixtures/configuration-fixture.ts'
import { Config } from '../src/config-base.ts'
import { TokenMonitorStore } from '../src/plugin-store.ts'
import { createSettingsHandle } from '../src/settings-handle.ts'
import { liveUserConfig } from '../src/user-settings.ts'
import {
  createTokenMonitorSettingsController,
  createTokenMonitorSettingsRouteHandler,
  readBillingSnapshot,
  TOKEN_MONITOR_SETTINGS_NS,
  type TokenMonitorSettingsController,
} from '../src/settings.ts'

/** 本包在 fixture 里的条目 id；上游夹具的默认条目名不能复用。 */
const NS = 'test-0'

const disposers: Array<() => Promise<void>> = []

afterEach(async () => {
  while (disposers.length > 0) await disposers.pop()!()
})
interface Booted {
  ctx: Context
  home: string
  patchPath: string
  store: TokenMonitorStore
  handle: ReturnType<typeof createSettingsHandle>
  controller(provider?: string): TokenMonitorSettingsController
}

/**
 * 真启动一次 profile：fixture 负责 Loader、ConfigEditor、profile patch 与 home 层，
 * 本包只把设置条目换成本插件的 `Config` schema。
 * @param doc 初始 profile patch 里的 config 段落。
 */
async function boot(doc: Record<string, unknown> = {}): Promise<Booted> {
  const fixture = await configurationFixture({
    schema: Config as never,
    apply: () => {},
    hmr: false,
  })
  // bundle patch 的形状是 `[{ insert: [...] }]`；把探针条目改成插件自己的命名空间 id，
  // 再把用户偏好写进 profile 层同名条目，正是生产环境 `insert` 落在 profile 层的形状。
  const bundle = join(fixture.profile.dir, 'node_modules', 'test-bundle', 'cordis.patch.yml')
  const layers = JSON.parse(await readFile(bundle, 'utf8')) as Array<{ insert: Array<{ id: string }> }>
  const insert = layers[0]!.insert
  insert.find(row => row.id === 'first')!.id = NS
  await writeFile(bundle, JSON.stringify(layers))
  await writeFile(fixture.profile.patchPath, JSON.stringify([{ id: NS, name: 'cordis:probe', config: doc }]))
  const ctx = await fixture.start()
  // fixture 的 home 是全新临时目录，插件的数据根也要先建出来。
  const dataDir = join(fixture.home, 'data', 'dsh-token-monitor')
  mkdirSync(dataDir, { recursive: true })
  const store = new TokenMonitorStore(dataDir)
  await store.load()
  const handle = createSettingsHandle(() => liveUserConfig(ctx, NS) ?? {}, store)
  return {
    ctx,
    home: fixture.home,
    patchPath: fixture.profile.patchPath,
    store,
    handle,
    // 夹具里的条目 id 与生产命名空间不同，控制器要按夹具 id 读写。
    controller: (provider?: string) => createTokenMonitorSettingsController(ctx, handle, provider, NS),
  }
}

async function serve(handler: ReturnType<typeof createTokenMonitorSettingsRouteHandler>) {
  const server: Server = createServer((request, response) => {
    handler(request, response).catch((error: unknown) => {
      response.writeHead(500)
      response.end(String(error))
    })
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  disposers.push(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())))
  return 'http://127.0.0.1:' + String((server.address() as AddressInfo).port)
}

describe('Token Monitor settings Host API', () => {
  it('persists a global animation ratio in the profile and retains it after reload', async () => {
    const initial = await boot()
    expect(initial.controller().read().settings.animationScale).toBe(0.8)
    await initial.controller().patch({ patch: { animationScale: 0.65 } })
    const patch = parse(await readFile(initial.patchPath, 'utf8')) as Array<{ id: string; config: Record<string, unknown> }>
    const persisted = patch.find(row => row.id === NS)!.config
    expect(persisted.animationScale).toBe(0.65)
    const reloaded = await boot(persisted)
    expect(reloaded.controller().read().settings.animationScale).toBe(0.65)
    expect(reloaded.controller('provider-a').read().settings.animationScale).toBe(0.65)
    await expect(reloaded.controller('provider-a').patch({ patch: { animationScale: 0.9 } })).rejects.toThrow('global')
    await reloaded.controller().patch({ patch: { animationScale: 0.8 } })
    expect(reloaded.controller().read().settings.animationScale).toBe(0.8)
  })
  it('isolates provider reminders while preserving global display preferences', async () => {
    const booted = await boot({ showWhaleGirl: false, dailyBudgetCny: 42 })
    const official = booted.controller()
    const first = booted.controller('provider-a')
    const second = booted.controller('provider-b')
    const before = first.read()
    expect(before.settings.showWhaleGirl).toBe(false)
    await first.patch({ expectedRevision: before.revision, patch: { dailyBudgetCny: 7, wechatNotificationsEnabled: true } })
    expect(first.read().settings).toMatchObject({ dailyBudgetCny: 7, wechatNotificationsEnabled: true, showWhaleGirl: false })
    expect(second.read().settings.wechatNotificationsEnabled).toBe(false)
    expect(official.read().settings.dailyBudgetCny).toBe(42)
    await expect(first.patch({ expectedRevision: first.read().revision, patch: { showWhaleGirl: true } })).rejects.toThrow('global')
    expect(official.read().settings.showWhaleGirl).toBe(false)
    const saved = parse(await readFile(booted.patchPath, 'utf8')) as Array<{ id: string; config: Record<string, unknown> }>
    expect(saved.find(row => row.id === NS)!.config).toMatchObject({
      showWhaleGirl: false,
      providerNotifications: { 'provider-a': { dailyBudgetCny: 7, wechatNotificationsEnabled: true } },
    })
  })

  it.each(['', '__proto__', 'constructor', 'prototype'])('rejects unsafe provider ids: %s', async (id) => {
    const booted = await boot()
    expect(() => booted.controller(id)).toThrow('provider id')
  })

  it('persists billing rules in plugin-owned state and advances its revision', async () => {
    const booted = await boot()
    const before = readBillingSnapshot(booted.store, booted.handle)
    const rules = structuredClone(before.rules)
    rules.providers[0]!.models[0]!.multiplier = 1.25
    await booted.store.update({ billing: rules }, before.revision)
    const after = readBillingSnapshot(booted.store, booted.handle)
    expect(after.revision).toBe(before.revision + 1)
    expect(after.rules.providers[0]!.models[0]!.multiplier).toBe(1.25)
    // 计费规则不属于用户偏好，profile patch 里不得出现该键。
    const saved = parse(await readFile(booted.patchPath, 'utf8')) as Array<{ id: string; config?: Record<string, unknown> }>
    expect(saved.find(row => row.id === NS)?.config ?? {}).not.toHaveProperty('billing')
  })

  it('keeps the persisted namespace, applies defaults, and never exposes internal fields', async () => {
    expect(TOKEN_MONITOR_SETTINGS_NS).toBe('dsh-token-monitor')
    const booted = await boot({ dailyBudgetCny: 25, priceTable: { version: 99 } })
    const snapshot = booted.controller().read()
    expect(snapshot.settings).toMatchObject({ dailyBudgetCny: 25, showWhaleGirl: true, displayMode: 'balance' })
    expect(snapshot.settings).not.toHaveProperty('priceTable')
    expect(booted.ctx.settings.describe().map(descriptor => descriptor.ns)).toContain(NS)
  })

  it('supports GET, HEAD, partial PATCH, no-op PATCH, and revision conflicts', async () => {
    const booted = await boot()
    const base = await serve(createTokenMonitorSettingsRouteHandler(booted.controller()))
    const endpoint = base + '/api/token-monitor/settings'

    const initial = await (await fetch(endpoint)).json() as { revision: number }
    expect((await fetch(endpoint, { method: 'HEAD' })).status).toBe(200)
    const changed = await (await fetch(endpoint, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expectedRevision: initial.revision, patch: { displayMode: 'spend' } }),
    })).json() as { revision: number; settings: { displayMode: string; showWhaleGirl: boolean } }
    expect(changed.settings).toMatchObject({ displayMode: 'spend', showWhaleGirl: true })
    expect(changed.revision).toBe(initial.revision + 1)

    const noOp = await (await fetch(endpoint, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expectedRevision: changed.revision, patch: {} }),
    })).json() as { revision: number }
    expect(noOp.revision).toBe(changed.revision)

    const conflict = await fetch(endpoint, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expectedRevision: initial.revision, patch: { showWhaleGirl: false } }),
    })
    expect(conflict.status).toBe(409)
    expect(await conflict.json()).toMatchObject({ error: { code: 'CONFLICT' } })
  })

  it.each([
    [{ method: 'POST' }, 405, 'METHOD_NOT_ALLOWED'],
    [{ method: 'PATCH', body: '{}' }, 415, 'UNSUPPORTED_MEDIA_TYPE'],
    [{ method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: '' }, 400, 'INVALID_JSON'],
    [{ method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ patch: { dailyBudgetCny: 1.234 } }) }, 400, 'VALIDATION_ERROR'],
    [{ method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: ' '.repeat(20_000) }, 413, 'PAYLOAD_TOO_LARGE'],
  ])('returns structured errors without internals', async (init, status, code) => {
    const booted = await boot()
    const base = await serve(createTokenMonitorSettingsRouteHandler(booted.controller()))
    const response = await fetch(base + '/api/token-monitor/settings', init)
    expect(response.status).toBe(status)
    const text = await response.text()
    expect(JSON.parse(text)).toMatchObject({ error: { code } })
    expect(text).not.toMatch(/settings\.json|stack/i)
  })
})
