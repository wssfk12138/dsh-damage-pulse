import { expect, it, vi } from 'vitest'
import { DEFAULT_TOKEN_MONITOR_SETTINGS, TOKEN_MONITOR_SETTINGS_SCHEMA_VERSION } from '@deepseek-ai/dsh-token-monitor-contract'
import { createTokenMonitorSettingsApi } from '../src/client/settingsApi.ts'

const snapshot = (revision: number, dailyBudgetCny = 5) => ({
  schemaVersion: TOKEN_MONITOR_SETTINGS_SCHEMA_VERSION,
  revision,
  settings: { ...DEFAULT_TOKEN_MONITOR_SETTINGS, dailyBudgetCny },
})
const reply = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status })

it('retries a namespace conflict when the edited provider fields have not changed', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(reply(snapshot(1)))
    .mockResolvedValueOnce(reply({ error: { code: 'CONFLICT' } }, 409))
    .mockResolvedValueOnce(reply(snapshot(3)))
    .mockResolvedValueOnce(reply(snapshot(4, 9)))
  const api = createTokenMonitorSettingsApi(fetcher)
  await api.get()
  expect((await api.patch({ expectedRevision: 1, patch: { dailyBudgetCny: 9 } })).revision).toBe(4)
  expect(JSON.parse(fetcher.mock.calls[3]![1].body)).toEqual({ expectedRevision: 3, patch: { dailyBudgetCny: 9 } })
})

it('retains a conflict when another writer changed the same setting', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(reply(snapshot(1)))
    .mockResolvedValueOnce(reply({ error: { code: 'CONFLICT' } }, 409))
    .mockResolvedValueOnce(reply(snapshot(2, 7)))
  const api = createTokenMonitorSettingsApi(fetcher)
  await api.get()
  await expect(api.patch({ expectedRevision: 1, patch: { dailyBudgetCny: 9 } })).rejects.toMatchObject({ code: 'CONFLICT' })
  expect(fetcher).toHaveBeenCalledTimes(3)
})
