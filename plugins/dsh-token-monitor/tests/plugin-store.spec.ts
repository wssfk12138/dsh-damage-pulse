import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, test } from 'vitest'
import { TokenMonitorStore } from '../src/plugin-store.ts'
import { defaultBillingRules } from '../src/billing.ts'
import { prepareLegacySettings } from '../src/legacy-settings.ts'

const dirs: string[] = []
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }) })
async function directory() { const dir = await mkdtemp(join(tmpdir(), 'token-store-')); dirs.push(dir); return dir }

test('a stale writer cannot overwrite another store instance', async () => {
  const dir = await directory()
  const first = new TokenMonitorStore(dir), second = new TokenMonitorStore(dir)
  await first.load(); await second.load()
  await first.update({ balanceEndpointPolicyVersion: 1 }, 0)
  await expect(second.update({ balanceEndpointPolicyVersion: 2 }, 0)).rejects.toThrow(/revision conflict/)
  expect(JSON.parse(await readFile(join(dir, 'state.json'), 'utf8')).balanceEndpointPolicyVersion).toBe(1)
})

test('corrupt persisted state is reported without replacing it', async () => {
  const dir = await directory()
  await writeFile(join(dir, 'state.json'), '{broken')
  await expect(new TokenMonitorStore(dir).load()).rejects.toThrow()
  expect(await readFile(join(dir, 'state.json'), 'utf8')).toBe('{broken')
})

test('explicit undefined removes owned billing configuration', async () => {
  const store = new TokenMonitorStore(await directory())
  await store.update({ billing: defaultBillingRules() })
  await store.update({ billing: undefined })
  expect(store.get().billing).toBeUndefined()
})

test('legacy migration keeps billing and preferences and does not reimport after completion', async () => {
  const home = await directory(), store = new TokenMonitorStore(join(home, 'data'))
  await store.load()
  const rules = defaultBillingRules()
  await writeFile(join(home, 'settings.yaml.imported'), JSON.stringify({ 'dsh-token-monitor': { billing: rules, dailyBudgetCny: 5, providerNotifications: { fast: { dailyBudgetEnabled: false } } } }))
  expect(await prepareLegacySettings(home, store)).toEqual({ dailyBudgetCny: 5, providerNotifications: { fast: { dailyBudgetEnabled: false } } })
  expect(store.get().billing).toEqual(rules)
  await store.update({ legacyMigrationVersion: 1 })
  expect(await prepareLegacySettings(home, store)).toBeUndefined()
})
