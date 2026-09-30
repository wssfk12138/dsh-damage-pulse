import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { Config } from '../src/config-base.ts'
import { registerUserSettings, writeUserConfig } from '../src/user-settings.ts'

describe('settings service family compatibility', () => {
  it('registers an absent legacy namespace once, preserving its existing preferences', () => {
    const descriptors: Array<{ ns: string }> = []
    const register = vi.fn((ns: string) => descriptors.push({ ns }))
    const ctx = { settings: { register, describe: () => descriptors } } as unknown as Context
    const entry = { dailyBudgetCny: 25 }
    registerUserSettings(ctx, entry as never)
    registerUserSettings(ctx, entry as never)
    expect(register).toHaveBeenCalledExactlyOnceWith('dsh-token-monitor', Config, { base: entry })
  })

  it('leaves profile namespace ownership with the Loader', () => {
    const ctx = { settings: { describe: () => [] } } as unknown as Context
    expect(() => registerUserSettings(ctx, {} as never)).not.toThrow()
  })

  it('retries conflicts from another service generation and normalizes a stale revision', async () => {
    let revision = 1
    const mutate = vi.fn(async (_ns, _ops, expected) => {
      if (expected !== revision) throw Object.assign(new Error('legacy revision conflict'), { code: 'SETTINGS_CONFLICT' })
      if (mutate.mock.calls.length === 1) { revision++; throw Object.assign(new Error('legacy revision conflict'), { code: 'SETTINGS_CONFLICT' }) }
    })
    const ctx = { settings: { describe: () => [{ ns: 'dsh-token-monitor', revision }], mutate } } as unknown as Context
    await writeUserConfig(ctx, { dailyBudgetCny: 35 })
    expect(mutate).toHaveBeenCalledTimes(2)
    await expect(writeUserConfig(ctx, { dailyBudgetCny: 1 }, 0)).rejects.toMatchObject({ code: 'SETTINGS_CONFLICT' })
  })
})
