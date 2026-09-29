// @vitest-environment jsdom
/**
 * 回归：账号路由（deepseek-account）的扣费事件必须能驱动鲸鱼娘的受击/扣血动画。
 * 已保存的旧计费快照只有 deepseek-official 条目，客户端的规则门禁若按精确 provider
 * 匹配就会把账号路由的事件整体丢掉（不飘字、不触发受击），与 Host 的 billUsage 回退不一致。
 */
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_TOKEN_MONITOR_SETTINGS, TOKEN_MONITOR_SETTINGS_SCHEMA_VERSION } from '@deepseek-ai/dsh-token-monitor-contract'
import { BalanceWidget } from '../src/client/BalanceWidget.tsx'
import type { ComponentProps } from 'react'

vi.mock('../src/client/WhaleGirlStage.tsx', () => ({ WhaleGirlStage: () => <div data-testid="whale-animation" /> }))
vi.mock('../src/client/settingsApi.ts', async importOriginal => ({
  ...await importOriginal<typeof import('../src/client/settingsApi.ts')>(),
  createTokenMonitorSettingsApi: () => ({
    get: async () => ({
      schemaVersion: TOKEN_MONITOR_SETTINGS_SCHEMA_VERSION,
      revision: 1,
      settings: { ...DEFAULT_TOKEN_MONITOR_SETTINGS, showWhaleGirl: true },
    }),
  }),
}))

afterEach(() => { cleanup(); localStorage.clear(); vi.useRealTimers(); vi.unstubAllGlobals() })

const officialEntry = { provider: 'deepseek-official', enabled: true, models: [{ model: 'deepseek-flash', enabled: true }] }

/** 挂载、投递一条扣费事件，返回逐刻度采样的姿态。 */
async function observePoses(provider: string, providers: unknown[]) {
  vi.useFakeTimers()
  const billingState = { snapshot: { revision: 2, rules: { version: 1, providers } }, invalid: false }
  const scope = { provider, model: 'deepseek-flash', sessionId: 'session-probe' }
  const chargeEvents = [{
    id: 'charge-1', seq: 1, cost: 0.02, damageKind: 'normal', provider, model: 'deepseek-flash',
    sourceEvent: { sessionId: 'session-probe', seq: 41 },
  }]
  let chargeCalls = 0
  vi.stubGlobal('fetch', vi.fn(async (input: string) => {
    let body: unknown = null
    if (input.includes('/settings')) body = { schemaVersion: TOKEN_MONITOR_SETTINGS_SCHEMA_VERSION, revision: 1, settings: { ...DEFAULT_TOKEN_MONITOR_SETTINGS, showWhaleGirl: true } }
    if (input.includes('/balance?')) body = { totalBalance: 10, currency: 'CNY' }
    if (input.includes('/charge-events')) {
      chargeCalls += 1
      body = chargeCalls <= 1 ? { events: [], seq: 0, streamId: 'probe' } : { events: chargeEvents, seq: 1, streamId: 'probe' }
    }
    return new Response(JSON.stringify(body))
  }))
  const props = {
    useSessions: (select: (state: unknown) => unknown) => select({ byId: {} }),
    loadDisplayScope: async () => scope,
    useBillingEvents: (select: (state: unknown) => unknown) => select(billingState),
    t: (key: string) => key,
  } as unknown as ComponentProps<typeof BalanceWidget>
  render(<BalanceWidget {...props} />)
  await act(async () => {})
  const pose = () => document.querySelector('[data-token-monitor-whale-pose]')?.getAttribute('data-token-monitor-whale-pose') ?? 'NONE'
  const samples: string[] = []
  for (let step = 0; step < 12; step += 1) {
    await act(async () => { await vi.advanceTimersByTimeAsync(150) })
    samples.push(pose())
  }
  return { samples, chargeCalls }
}

describe('whale charge reaction', () => {
  it('reacts to an account-route charge when the saved rules only carry the official entry', async () => {
    const { samples, chargeCalls } = await observePoses('deepseek-account', [officialEntry])
    console.log('ACCOUNT chargeCalls=' + String(chargeCalls) + ' samples=' + samples.join(','))
    expect(samples).toContain('normal-pain')
  })

  it('still ignores a charge whose provider has no configured rule at all', async () => {
    const { samples } = await observePoses('unconfigured-provider', [officialEntry])
    console.log('UNCONFIGURED samples=' + samples.join(','))
    expect(samples.every((sample) => sample === 'idle' || sample === 'NONE')).toBe(true)
  })
})
