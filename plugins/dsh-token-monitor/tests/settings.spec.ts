import { createServer, type Server } from 'node:http'
import { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SettingsProvider, type SettingsNamespace } from '@deepseek-ai/dsh-settings'
import {
  createTokenMonitorSettingsController,
  createTokenMonitorSettingsRouteHandler,
  registerTokenMonitorSettings,
  TOKEN_MONITOR_SETTINGS_NS,
} from '../src/settings.ts'
import { OFFICIAL_PROVIDER_ID, PRICE_TABLE, PRE_FLASH_PRICE_TABLE, priceUsage, selectPriceTable } from '../src/pricing.ts'

const disposers: Array<() => Promise<void>> = []

class MemorySettings extends SettingsProvider {
  doc: Record<string, unknown>
  writableFlag = true

  constructor(ctx: Context, options: { doc?: Record<string, unknown> } = {}) {
    super(ctx)
    this.doc = structuredClone(options.doc ?? {})
  }

  get writable(): boolean {
    return this.writableFlag
  }

  protected load(): Promise<Record<string, unknown>> {
    return Promise.resolve(structuredClone(this.doc))
  }

  protected persist(ns: SettingsNamespace, section: Record<string, unknown>): Promise<void> {
    if (!this.writableFlag) return Promise.reject(new Error('fixture is read-only'))
    this.doc[ns] = structuredClone(section)
    return Promise.resolve()
  }
}

afterEach(async () => {
  while (disposers.length > 0) await disposers.pop()!()
})

async function boot(doc: Record<string, unknown> = {}) {
  const ctx = new Context()
  const fiber = ctx.plugin(MemorySettings, { doc })
  await fiber
  const provider = ctx.settings as MemorySettings
  const registration = registerTokenMonitorSettings(provider)
  await registration.ready
  disposers.push(() => fiber.dispose())
  return { provider, registration }
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
  return `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`
}

describe('Token Monitor settings Host API', () => {
  it('keeps the persisted namespace unchanged without a runtime branding helper', async () => {
    expect(TOKEN_MONITOR_SETTINGS_NS).toBe('dsh-token-monitor')
    const { provider, registration } = await boot({
      'dsh-token-monitor': { dailyBudgetCny: 42 },
    })
    expect(registration.scope.get().dailyBudgetCny).toBe(42)
    expect(provider.describe().map(descriptor => descriptor.ns)).toContain('dsh-token-monitor')
  })

  it('migrates legacy settings, applies defaults, and never exposes priceTable', async () => {
    const { provider, registration } = await boot({
      [TOKEN_MONITOR_SETTINGS_NS]: { dailyBudgetCny: 25, priceTable: { version: 99 } },
    })
    const snapshot = createTokenMonitorSettingsController(provider, registration.scope).read()
    expect(snapshot.settings).toMatchObject({ dailyBudgetCny: 25, showWhaleGirl: true, displayMode: 'balance' })
    expect(snapshot.settings).not.toHaveProperty('priceTable')
    expect(provider.doc[TOKEN_MONITOR_SETTINGS_NS]).toMatchObject({
      schemaVersion: 3,
      dailyBudgetCny: 25,
      budgetExceededNotificationEnabled: false,
    })
  })

  it('keeps the settings-resolved default table on the official history segments', async () => {
    const { registration } = await boot()
    // settings 解析默认值时会深拷贝价格表：内容与内置表一致，必须仍按官方表做历史分段。
    const table = registration.scope.get().priceTable
    expect(table).toEqual(PRICE_TABLE)
    const historicalValley = Date.parse('2026-09-09T12:00:00+08:00')
    expect(selectPriceTable(historicalValley, table)).toBe(PRE_FLASH_PRICE_TABLE)
    expect(priceUsage(1_000_000, 0, 0, 0, OFFICIAL_PROVIDER_ID, 'deepseek-v4-flash', historicalValley, table)?.cost).toBe(1.5)
  })

  it('supports GET, HEAD, partial PATCH, no-op PATCH, and revision conflicts', async () => {
    const { provider, registration } = await boot()
    const endpoint = `${await serve(createTokenMonitorSettingsRouteHandler(
      createTokenMonitorSettingsController(provider, registration.scope),
    ))}/api/token-monitor/settings`

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

  it('round-trips a health bar colour preset and rejects a non-preset', async () => {
    const { provider, registration } = await boot()
    const endpoint = `${await serve(createTokenMonitorSettingsRouteHandler(
      createTokenMonitorSettingsController(provider, registration.scope),
    ))}/api/token-monitor/settings`

    const initial = await (await fetch(endpoint)).json() as {
      revision: number
      settings: { healthBarColor: string; healthBarMaxCny: number }
    }
    // 旧配置没有这个字段时，schema 默认值必须补上，否则客户端换色无从选择。
    expect(initial.settings.healthBarColor).toBe('red')

    const changed = await (await fetch(endpoint, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expectedRevision: initial.revision, patch: { healthBarColor: 'cyan' } }),
    })).json() as { settings: { healthBarColor: string } }
    expect(changed.settings.healthBarColor).toBe('cyan')
    // 重新读取仍然生效，说明它真的落到了 settings store 而不是只改了响应。
    expect(((await (await fetch(endpoint)).json()) as { settings: { healthBarColor: string } }).settings.healthBarColor).toBe('cyan')

    const rejected = await fetch(endpoint, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ patch: { healthBarColor: '#ff0000' } }),
    })
    expect(rejected.status).toBe(400)
    expect(await rejected.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR', details: { fields: { 'patch.healthBarColor': expect.any(String) } } } })
  })

  it('round-trips a damage effect level and rejects a non-preset', async () => {
    const { provider, registration } = await boot()
    const endpoint = `${await serve(createTokenMonitorSettingsRouteHandler(
      createTokenMonitorSettingsController(provider, registration.scope),
    ))}/api/token-monitor/settings`

    const initial = await (await fetch(endpoint)).json() as {
      revision: number
      settings: { damageEffectLevel: string }
    }
    // 旧配置没有这个字段时必须补成正常档，而不是悄悄把特效关掉。
    expect(initial.settings.damageEffectLevel).toBe('normal')

    const changed = await (await fetch(endpoint, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expectedRevision: initial.revision, patch: { damageEffectLevel: 'off' } }),
    })).json() as { settings: { damageEffectLevel: string } }
    expect(changed.settings.damageEffectLevel).toBe('off')
    expect(((await (await fetch(endpoint)).json()) as { settings: { damageEffectLevel: string } }).settings.damageEffectLevel).toBe('off')

    const rejected = await fetch(endpoint, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ patch: { damageEffectLevel: 2 } }),
    })
    expect(rejected.status).toBe(400)
    expect(await rejected.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR', details: { fields: { 'patch.damageEffectLevel': expect.any(String) } } } })
  })

  it.each([
    [{ method: 'POST' }, 405, 'METHOD_NOT_ALLOWED'],
    [{ method: 'PATCH', body: '{}' }, 415, 'UNSUPPORTED_MEDIA_TYPE'],
    [{ method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: '' }, 400, 'INVALID_JSON'],
    [{ method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ patch: { dailyBudgetCny: 1.234 } }) }, 400, 'VALIDATION_ERROR'],
    [{ method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: ' '.repeat(20_000) }, 413, 'PAYLOAD_TOO_LARGE'],
  ])('returns structured errors without internals', async (init, status, code) => {
    const { provider, registration } = await boot()
    const endpoint = `${await serve(createTokenMonitorSettingsRouteHandler(
      createTokenMonitorSettingsController(provider, registration.scope),
    ))}/api/token-monitor/settings`
    const response = await fetch(endpoint, init)
    expect(response.status).toBe(status)
    const text = await response.text()
    expect(JSON.parse(text)).toMatchObject({ error: { code } })
    expect(text).not.toMatch(/E:\\|stack|settings\.json/i)
  })

  it('keeps the committed snapshot unchanged when persistence fails', async () => {
    const { provider, registration } = await boot()
    const controller = createTokenMonitorSettingsController(provider, registration.scope)
    const before = controller.read()
    provider.writableFlag = false
    const endpoint = `${await serve(createTokenMonitorSettingsRouteHandler(controller))}/api/token-monitor/settings`
    const response = await fetch(endpoint, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expectedRevision: before.revision, patch: { showWhaleGirl: false } }),
    })
    expect(response.status).toBe(500)
    expect(await response.json()).toMatchObject({ error: { code: 'WRITE_FAILED' } })
    expect(controller.read()).toEqual(before)
  })

  it('restores settings from a persisted public-provider document after a provider restart', async () => {
    const first = await boot({ 'other-plugin': { keep: true } })
    await first.registration.scope.update({
      dailyBudgetEnabled: false,
      dailyBudgetCny: 88.88,
      peakReminderEnabled: false,
      peakReminderEnterPeak: false,
      peakReminderEnterValley: true,
    })
    const persisted = structuredClone(first.provider.doc)

    const second = await boot(persisted)
    expect(second.registration.scope.get()).toMatchObject({
      dailyBudgetEnabled: false,
      dailyBudgetCny: 88.88,
      peakReminderEnabled: false,
      peakReminderEnterPeak: false,
      peakReminderEnterValley: true,
    })
    expect(second.provider.doc['other-plugin']).toEqual({ keep: true })
  })
})
