import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { BalanceEndpointMismatchError, BalanceScriptConfig, SensitiveBalanceScriptError } from '../src/balance-config.ts'
import { TokenMonitorStore, type TokenMonitorStoreDocument } from '../src/plugin-store.ts'
import { OFFICIAL_BALANCE_SCRIPT } from '../src/balance-script.ts'
import { migrateBalanceEndpointPolicy } from '../src/balance-migration.ts'
import { BUILT_IN_BALANCE_ADAPTERS, type BuiltInBalanceAdapter } from '../src/balance-adapters.ts'

/** Keyless relay adapter naming one relative endpoint. */
const adapter = (path = '/v1/usage') =>
  '({ request: { path: "' + path + '", method: "GET", auth: "bearer" }, parse(response) { return { currency: "CNY", totalBalance: 1 } } })'

const homes: string[] = []
afterEach(() => { for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true }) })

/** 插件自有状态落盘一次后再交给被测对象，等价于旧 settings 文档的播种。 */
async function boot(seed: Partial<TokenMonitorStoreDocument> = {}, resolved?: BuiltInBalanceAdapter) {
  const home = mkdtempSync(join(tmpdir(), 'token-monitor-balance-'))
  homes.push(home)
  const store = new TokenMonitorStore(join(home, 'data'))
  await store.load()
  if (Object.keys(seed).length > 0) await store.update(seed)
  await migrateBalanceEndpointPolicy(store)
  return new BalanceScriptConfig(store, async () => resolved)
}

const fastai = BUILT_IN_BALANCE_ADAPTERS.find(adapter => adapter.label === 'fastaitoken')!

describe('provider script persistence', () => {
  it('seeds official only and retains invalid edits with independent revisions', async () => {
    const config = await boot()
    expect(await config.read('deepseek-official')).toMatchObject({ status: 'valid', revision: 0 })
    expect(await config.read('a')).toMatchObject({ status: 'unconfigured', revision: 0 })
    expect(await config.update('a', 'broken script', 0)).toMatchObject({ status: 'invalid', script: 'broken script', revision: 1 })
    expect(await config.update('b', OFFICIAL_BALANCE_SCRIPT, 0)).toMatchObject({ status: 'unapproved', revision: 1 })
    await expect(config.update('a', '', 0)).rejects.toThrow('conflict')
    expect(await config.update('a', '', 1)).toMatchObject({ status: 'unconfigured', revision: 2 })
    expect(await config.read('b')).toMatchObject({ status: 'unapproved', revision: 1 })
    expect(await config.update('deepseek-official', '', 0)).toMatchObject({ status: 'unconfigured', revision: 1 })
  })

  it('merges simultaneous edits to different providers without losing either', async () => {
    const config = await boot()
    await Promise.all([config.update('a', OFFICIAL_BALANCE_SCRIPT, 0), config.update('b', OFFICIAL_BALANCE_SCRIPT, 0)])
    expect(await config.read('a')).toMatchObject({ status: 'unapproved', revision: 1 })
    expect(await config.read('b')).toMatchObject({ status: 'unapproved', revision: 1 })
  })

  it('rejects credential-bearing source without changing the saved revision', async () => {
    const config = await boot()
    const secret = 'sk-sensitive-value-123456'
    const attempts = [
      '({ request: { path: "/v1/usage", method: "GET", headers: { Authorization: "Bearer ' + secret + '" } }, parse() {} })',
      '({ request: { path: "/v1/usage", method: "GET", "x-api-key": "' + secret + '" }, parse() {} })',
      '({ request: { url: "https://user:' + secret + '@a.example/v1/usage", method: "GET", auth: "bearer" }, parse() {} })',
      '(() => { const apiKey = "' + secret + '"; return { request: {}, parse() {} } })()',
    ]
    for (const script of attempts) {
      const failure = await config.update('a', script, 0).catch((error: unknown) => error)
      expect(failure).toBeInstanceOf(SensitiveBalanceScriptError)
      expect(String(failure)).not.toContain(secret)
      expect(await config.read('a')).toMatchObject({ status: 'unconfigured', revision: 0, script: '' })
    }
  })

  it('pauses an unapproved endpoint, approves only the declared one and re-pauses a moved adapter', async () => {
    const config = await boot()
    expect(await config.update('fast', adapter(), 0)).toMatchObject({
      status: 'unapproved',
      request: { path: '/v1/usage', method: 'GET' },
    })
    await expect(config.approve('fast', { path: '/v1/other', method: 'GET' })).rejects.toBeInstanceOf(BalanceEndpointMismatchError)
    await expect(config.approve('fast', { path: '/v1/usage', method: 'POST' })).rejects.toBeInstanceOf(BalanceEndpointMismatchError)
    expect(await config.approve('fast', { path: '/v1/usage', method: 'GET' })).toMatchObject({ status: 'valid', revision: 1 })
    expect(await config.read('fast')).toMatchObject({ status: 'valid', revision: 1 })
    expect(await config.update('fast', adapter('/v1/balance'), 1)).toMatchObject({ status: 'unapproved' })
    expect(await config.approve('fast', { path: '/v1/balance', method: 'GET' })).toMatchObject({ status: 'valid' })
  })

  it('carries over a pre-existing GET adapter during the one-time policy migration', async () => {
    const config = await boot({
      schemaVersion: 3,
      balanceScripts: { fast: { revision: 2, script: adapter() } },
    } as Partial<TokenMonitorStoreDocument>)
    expect(await config.read('fast')).toMatchObject({ status: 'valid', revision: 2 })
  })

  it('never auto-approves once the policy marker exists', async () => {
    const config = await boot({
      schemaVersion: 3,
      balanceEndpointPolicyVersion: 1,
      balanceScripts: { fast: { revision: 1, script: adapter('/v1/balance') } },
    } as Partial<TokenMonitorStoreDocument>)
    expect(await config.read('fast')).toMatchObject({ status: 'unapproved', revision: 1 })
  })

  it('serves a configured gateway through a shipped adapter without any saved script', async () => {
    const config = await boot({}, fastai)
    expect(await config.read('fast')).toMatchObject({
      status: 'valid', source: 'built-in', adapter: 'fastaitoken', revision: 0, script: fastai.script,
      request: { path: '/v1/usage', method: 'GET' },
    })
  })

  it('lets saved text override or switch off the shipped adapter', async () => {
    const config = await boot({}, fastai)
    expect(await config.update('fast', adapter('/v1/other'), 0)).toMatchObject({ status: 'unapproved' })
    expect((await config.read('fast')).source).toBeUndefined()
    const cleared = await boot({}, fastai)
    expect(await cleared.update('fast', '', 0)).toMatchObject({ status: 'unconfigured' })
    expect(await cleared.read('fast')).toMatchObject({ status: 'unconfigured', script: '' })
  })

  it('allows keyless auth declarations and retains ordinary invalid source', async () => {
    const config = await boot()
    const keyless = '({ request: { path: "/v1/usage", method: "GET", auth: "x-api-key" }, parse() { return {} } })'
    expect(await config.update('a', keyless, 0)).toMatchObject({ status: 'unapproved', revision: 1, script: keyless })
    expect(await config.approve('a', { path: '/v1/usage', method: 'GET' })).toMatchObject({ status: 'valid', revision: 1, script: keyless })
    expect(await config.update('b', 'broken script', 0)).toMatchObject({ status: 'invalid', revision: 1, script: 'broken script' })
  })

  it('hides credential-bearing source already present in settings', async () => {
    const secret = 'sk-historical-value-123456'
    const config = await boot({
      balanceScripts: { a: { revision: 4, script: '({ apiKey: "' + secret + '" })' } },
    } as Partial<TokenMonitorStoreDocument>)
    const snapshot = await config.read('a')
    expect(snapshot).toMatchObject({ status: 'invalid', revision: 4, script: '' })
    expect(JSON.stringify(snapshot)).not.toContain(secret)
  })
})
