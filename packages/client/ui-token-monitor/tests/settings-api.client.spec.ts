import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_TOKEN_MONITOR_SETTINGS } from '../../../util/token-monitor-contract/src/index.ts'
import {
  createTokenMonitorSettingsApi,
  isUnknownSettingFieldError,
  TokenMonitorSettingsApiError,
  TokenMonitorSettingsProtocolError,
} from '../src/client/settingsApi.ts'

const snapshot = { schemaVersion: 3 as const, revision: 2, settings: { ...DEFAULT_TOKEN_MONITOR_SETTINGS } }

describe('Token Monitor settings client', () => {
  it('loads and patches the dedicated endpoint', async () => {
    const fetcher = vi.fn().mockImplementation(() => Promise.resolve(
      new Response(JSON.stringify(snapshot), { status: 200 }),
    ))
    const api = createTokenMonitorSettingsApi(fetcher)
    await expect(api.get()).resolves.toEqual(snapshot)
    await expect(api.patch({ expectedRevision: 2, patch: { showWhaleGirl: false } })).resolves.toEqual(snapshot)
    expect(fetcher).toHaveBeenNthCalledWith(1, '/api/token-monitor/settings', { cache: 'no-store' })
    expect(fetcher).toHaveBeenNthCalledWith(2, '/api/token-monitor/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expectedRevision: 2, patch: { showWhaleGirl: false } }),
      cache: 'no-store',
    })
  })

  it('preserves structured Host errors', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: { code: 'VALIDATION_ERROR', message: 'bad setting', details: { fields: { 'patch.dailyBudgetCny': 'bad' } } },
    }), { status: 400 }))
    const api = createTokenMonitorSettingsApi(fetcher)
    await expect(api.patch({ patch: {} })).rejects.toMatchObject({
      status: 400,
      code: 'VALIDATION_ERROR',
      fields: { 'patch.dailyBudgetCny': 'bad' },
    })
  })

  it('rejects malformed success payloads and invalid JSON', async () => {
    await expect(createTokenMonitorSettingsApi(vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ revision: 1 }), { status: 200 }),
    )).get()).rejects.toBeInstanceOf(TokenMonitorSettingsProtocolError)
    await expect(createTokenMonitorSettingsApi(vi.fn().mockResolvedValue(
      new Response('not-json', { status: 200 }),
    )).get()).rejects.toBeInstanceOf(TokenMonitorSettingsProtocolError)
  })

  /**
   * The page reloads the Client bundle from disk, but the Host plugin is loaded into
   * the server process once at startup — so refreshing the page can leave a newer
   * Client talking to an older Host. The older Host answers "未知设置字段" for any
   * setting it has never heard of, and that specific refusal is what tells the caller
   * to ask for a restart instead of reporting a generic save failure.
   */
  it('recognises a Host that does not know a field yet', async () => {
    const staleHost = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: {
        code: 'VALIDATION_ERROR',
        message: '设置字段校验失败',
        details: { fields: { 'patch.healthBarColor': '未知设置字段' } },
      },
    }), { status: 400 }))
    const error = await createTokenMonitorSettingsApi(staleHost)
      .patch({ patch: { healthBarColor: 'cyan' } })
      .then(() => null, (caught: unknown) => caught)

    expect(isUnknownSettingFieldError(error)).toBe(true)
  })

  it('does not mistake an ordinary validation rejection for version skew', async () => {
    const invalidValue = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: {
        code: 'VALIDATION_ERROR',
        message: '设置字段校验失败',
        details: { fields: { 'patch.healthBarMaxCny': '必须在 0.01 到 1000000 之间' } },
      },
    }), { status: 400 }))
    const rejected = await createTokenMonitorSettingsApi(invalidValue)
      .patch({ patch: { healthBarMaxCny: 0 } })
      .then(() => null, (caught: unknown) => caught)
    expect(isUnknownSettingFieldError(rejected)).toBe(false)

    // 非校验类失败同样不算版本错配。
    const conflict = new TokenMonitorSettingsApiError(409, 'CONFLICT', '设置已被其他窗口更新')
    expect(isUnknownSettingFieldError(conflict)).toBe(false)
    expect(isUnknownSettingFieldError(new Error('boom'))).toBe(false)
  })
})
