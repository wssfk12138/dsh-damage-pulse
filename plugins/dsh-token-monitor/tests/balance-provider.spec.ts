import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { resolveBalanceIdentity } from '../src/balance-provider.ts'
import { validateBalanceProviders } from '../src/balance-storage.ts'

function context() {
  return {
    credentials: { resolve: vi.fn().mockResolvedValue({ value: 'balance-key' }) },
    llm: { listConfigurableProviders: vi.fn(() => [{ provider: 'fast', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'fast'] }]) },
    settings: { get: vi.fn(() => ({ providers: { fast: { baseURL: 'http://127.0.0.1:10100/v1' } } })) },
  }
}

describe('balance provider identity', () => {
  it('uses an independent HTTPS endpoint and credential when the model route is a local proxy', async () => {
    const ctx = context()
    await expect(resolveBalanceIdentity(ctx as unknown as Context, 'fast', {
      baseURL: 'https://www.fastaitoken.com', apiKeyEnv: 'FASTAI_BALANCE_API_KEY',
    })).resolves.toEqual({ apiKey: 'balance-key', baseURL: 'https://www.fastaitoken.com' })
    expect(ctx.credentials.resolve).toHaveBeenCalledWith('FASTAI_BALANCE_API_KEY')
    expect(ctx.settings.get).not.toHaveBeenCalled()
  })

  it('rejects balance endpoints that could receive credentials outside an exact HTTPS origin', () => {
    for (const baseURL of [
      'http://www.fastaitoken.com',
      'https://user:secret@www.fastaitoken.com',
      'https://www.fastaitoken.com?next=other',
      'https://www.fastaitoken.com:8443',
    ]) expect(() => validateBalanceProviders({ fast: { baseURL, apiKeyEnv: 'FASTAI_BALANCE_API_KEY' } })).toThrow()
  })
})
