/** Explicit built-payload smoke; owns only a fresh fixture beside this script. */
import assert from 'node:assert/strict'
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { setTimeout } from 'node:timers/promises'
import { Context } from '@deepseek-ai/cordis'
import { boot as bootProfile, initProfile, readProfilePatches } from '@deepseek-ai/dsh-app-boot'
import ConfigEditor from '@deepseek-ai/dsh-config-editor'
import Settings from '@deepseek-ai/dsh-settings'
import Timer from '@deepseek-ai/cordis-plugin-timer'
import { realpathSync } from 'node:fs'
import Sessions from '@deepseek-ai/dsh-session'
import WebServer from '@deepseek-ai/dsh-host-webserver'
const directory = dirname(fileURLToPath(import.meta.url))
const sourcePackage = process.argv[2] && resolve(process.argv[2])
if (!sourcePackage) throw new Error('Specify the extracted package directory from the tgz')
const root = await mkdtemp(join(dirname(sourcePackage), '.tgz-smoke-'))
process.env.DSH_HOME = join(root, 'home')
const installedPackage = join(root, 'node_modules', 'dsh-damage-pulse')
await cp(sourcePackage, installedPackage, { recursive: true })
const installed = await import(pathToFileURL(join(installedPackage, 'lib/index.js')).href)
const { Config, apply: applyInstalled } = installed
let ctx
try {
  const usageDir = join(root, 'home', 'data', 'dsh-token-monitor')
  await mkdir(usageDir, { recursive: true })
  const seededTimestamp = Date.now() - 1_000
  await writeFile(join(usageDir, 'usage.jsonl'), JSON.stringify({
    sessionId: 'fixture-session', turn: 1, step: 1, sourceEventSeq: 1, timestamp: seededTimestamp,
    provider: 'deepseek-official', model: 'deepseek-v4-flash', inputTokens: 1_000_000,
    cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0, reasoningTokens: 0,
    costInput: 1, costCache: 0, costCacheRead: 0, costCacheWrite: 0, costOutput: 0, cost: 1,
    peak: false, billingStatus: 'priced',
  }) + '\n')
  const manifest = JSON.parse(await readFile(join(installedPackage, 'runtime/manifest.json'), 'utf8'))
  assert.equal((await readFile(join(installedPackage, 'runtime/host/core.mjs'), 'utf8')).includes('quickjs-emscripten'), false)
  const start = async () => {
    await mkdir(join(root, 'profile'), { recursive: true })
    const profileHome = realpathSync(join(root, 'profile'))
    const profileDir = join(profileHome, 'profiles', 'fixture')
    await mkdir(join(profileDir, 'node_modules', 'fixture-bundle'), { recursive: true })
    await writeFile(join(profileHome, 'package.json'), '{"name":"fixture-installation"}\n')
    await writeFile(join(profileDir, 'cordis.yml'), '[]\n')
    const profilePatch = join(profileDir, 'cordis.profile.yml')
    try { await readFile(profilePatch, 'utf8') } catch { await writeFile(profilePatch, '[]\n') }
    await writeFile(join(profileDir, 'node_modules', 'fixture-bundle', 'package.json'), JSON.stringify({ name: 'fixture-bundle', version: '1.0.0', dsh: { bundle: { patch: 'cordis.patch.yml' } } }))
    const patch = JSON.stringify([{ insert: [
      { id: 'config-editor', name: 'cordis:editor' },
      { id: 'settings', name: 'cordis:settings' },
      { id: 'dsh-token-monitor', name: 'cordis:probe', config: {} },
    ] }])
    await writeFile(join(profileDir, 'node_modules', 'fixture-bundle', 'cordis.patch.yml'), patch)
    initProfile(profileDir, ['fixture-bundle'])
    const profile = { name: 'fixture', startedBundles: ['fixture-bundle'], dir: profileDir, patchPath: profilePatch, installAnchor: join(profileHome, 'package.json'), cwd: profileHome, home: profileHome, overlays: [], telemetryDisabledEnv: undefined }
    ctx = await bootProfile('fixture', join(profileDir, 'cordis.yml'), readProfilePatches('fixture', profile), (next) => {
      next.provide('profileContext', profile)
      Object.assign(next.loader.builtins, { editor: ConfigEditor, settings: Settings, probe: { Config, apply() {} } })
    })
    await ctx.plugin(Timer).await()
    await ctx.plugin(Sessions).await()
    await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 }).await()
    ctx.provide('connection', { requestRejection: () => undefined })
    await ctx.plugin({ name: 'built-token-monitor', Config, inject: ['settings', 'sessions'], apply: applyInstalled }).await()
    return 'http://127.0.0.1:' + ctx.webServer.port
  }
  let url = await start()
  const snapshot = async () => (await fetch(url + '/api/token-monitor/modules')).json()
  const uninstall = async (ids, wholePlugin = false, preserveData = true) => {
    const current = await snapshot()
    const response = await fetch(url + '/api/token-monitor/modules/uninstall', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids, wholePlugin, preserveData, expectedRevision: current.revision }) })
    const result = await response.json()
    assert.equal(response.status, 200, JSON.stringify(result))
    assert.equal(result.cleanupErrors, undefined, JSON.stringify(result))
    return result
  }
  assert.equal((await snapshot()).modules.filter(m => m.status === 'installed').length, 5)
  const usageResponse = await fetch(url + '/api/token-monitor/usage')
  assert.equal(usageResponse.status, 200)
  const usage = await usageResponse.json()
  assert.equal(usage.length, 1)
  assert.equal(usage[0].provider, 'deepseek-official')
  assert.equal(usage[0].model, 'deepseek-v4-flash')
  assert.equal(usage[0].billingStatus, 'priced')
  assert.equal(usage[0].cost > 0, true)
  const usageSummary = await (await fetch(url + '/api/token-monitor/usage-summary?range=all')).json()
  assert.equal(usageSummary.requestCount, 1)
  assert.equal(usageSummary.spendCny > 0, true)
  for (let attempt = 0; attempt < 40; attempt++) {
    if ((await fetch(url + '/api/token-monitor/billing')).status === 200) break
    await setTimeout(50)
  }
  const billingResponse = await fetch(url + '/api/token-monitor/billing')
  assert.equal(billingResponse.status, 200)
  const billing = await billingResponse.json()
  assert.equal(Array.isArray(billing.rules?.providers), true)
  assert.equal(billing.rules.providers.length > 0, true)
  assert.equal(billing.rules.providers.some(provider => provider.provider === 'deepseek-official'), true)
  const assetResponse = await fetch(url + '/assets/dsh-token-monitor/whale-girl/idle.png')
  assert.equal(assetResponse.status, 200)
  assert.match(assetResponse.headers.get('content-type') ?? '', /^image\/png/i)
  const assetBytes = new Uint8Array(await assetResponse.arrayBuffer())
  assert.equal(assetBytes.length > 8, true)
  assert.deepEqual([...assetBytes.slice(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10])
  await ctx.settings.mutate('dsh-token-monitor', [{ op: 'set', path: ['showWhaleGirl'], value: false }])
  const settingsAfterWrite = await (await fetch(url + '/api/token-monitor/settings')).json()
  assert.equal(settingsAfterWrite.settings.showWhaleGirl, false)
  await uninstall(['billing'])
  assert.equal((await fetch(url + '/api/token-monitor/billing')).status, 404)
  for (const file of manifest.modules.find(m => m.id === 'billing').files) await assert.rejects(readFile(join(installedPackage, 'runtime', file.root, file.path)), { code: 'ENOENT' })
  assert.equal((await fetch(url + '/api/token-monitor/usage')).status, 200)
  await ctx.fiber.dispose()
  url = await start()
  assert.equal((await snapshot()).modules.find(m => m.id === 'billing').status, 'removed')
  const settingsAfterRestart = await (await fetch(url + '/api/token-monitor/settings')).json()
  assert.equal(settingsAfterRestart.settings.showWhaleGirl, false)
  const removed = await uninstall([], true, false)
  assert.equal(removed.pluginRemoved, true)
  assert.equal(removed.cleanupPending, undefined)
  for (const file of manifest.core) await assert.rejects(readFile(join(installedPackage, 'runtime', file.root, file.path)), { code: 'ENOENT' })
  await ctx.fiber.dispose()
  // Retry whole-plugin erasure with the core already physically absent.
  const statePath = join(installedPackage, 'runtime/state.json')
  const state = JSON.parse(await readFile(statePath, 'utf8'))
  state.wholePlugin.erased = false; state.wholePlugin.pending = true
  await writeFile(statePath, JSON.stringify(state))
  url = await start()
  assert.equal((await fetch(url + '/api/token-monitor/modules')).status, 404)
  assert.equal(JSON.parse(await readFile(statePath, 'utf8')).wholePlugin.pending, false)
  assert.equal((await readFile(join(sourcePackage, 'runtime/manifest.json'), 'utf8')).length > 0, true)
  assert.equal((await readFile(join(root, 'profile', 'profiles', 'fixture', 'cordis.profile.yml'), 'utf8')).includes('showWhaleGirl'), false)
  console.log('Built payload smoke: boot, physical removal, tombstone restart, whole removal, absent-core cleanup PASS')
} finally {
  await ctx?.fiber.dispose()
  // root is generated inside this script directory and never accepts user input.
  assert.equal(dirname(root), dirname(sourcePackage))
  await rm(root, { recursive: true, force: true })
}
