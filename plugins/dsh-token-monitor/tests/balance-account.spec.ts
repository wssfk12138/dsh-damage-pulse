import { describe, expect, it, vi } from 'vitest'
import { AccountBalanceSource, parseAccountBalance } from '../src/balance-account.ts'
import { BalanceRegistry } from '../src/balance-registry.ts'

const ready = { status: 'ready', value: [{ currency: 'CNY', balance: '120.00' }], bonusWallets: [{ currency: 'CNY', balance: '3.45' }] }

describe('native account balance', () => {
  it('waits for slow configuration inspection on stop and never starts a later native request', async () => {
    let finish!: (value: unknown) => void
    const deps = { readScript: vi.fn(() => new Promise(resolve => { finish = resolve })), resolveIdentity: vi.fn(), request: vi.fn() }
    const read = vi.fn().mockResolvedValue(ready)
    const registry = new BalanceRegistry(deps as unknown as ConstructorParameters<typeof BalanceRegistry>[0])
    registry.setAccountSource(new AccountBalanceSource(read))
    const pending = registry.get('deepseek-account')
    let stopped = false
    const stopping = registry.stop().then(() => { stopped = true })
    await Promise.resolve(); await Promise.resolve()
    expect(stopped).toBe(false)
    finish({ provider: 'deepseek-account', revision: 1, status: 'valid', script: '' })
    await stopping
    expect(await pending).toBeUndefined()
    expect(read).not.toHaveBeenCalled()
  })
  it('honors paused configuration, rejects a pending stale result, and resumes explicitly', async () => {
    let script = { provider: 'deepseek-account', revision: 1, script: '', status: 'unconfigured' as 'valid' | 'unconfigured' }
    let finish!: (value: unknown) => void
    const read = vi.fn().mockResolvedValue(ready)
    const deps = { readScript: vi.fn(async () => script), resolveIdentity: vi.fn(), request: vi.fn() }
    const registry = new BalanceRegistry(deps)
    registry.setAccountSource(new AccountBalanceSource(read))
    expect(await registry.get('deepseek-account')).toBeUndefined()
    expect(read).not.toHaveBeenCalled()
    read.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    script = { ...script, revision: 2, status: 'valid' }
    const pending = registry.get('deepseek-account')
    await vi.waitFor(() => expect(read).toHaveBeenCalledOnce())
    script = { ...script, revision: 3, status: 'unconfigured' }
    finish(ready)
    expect(await pending).toBeUndefined()
    expect(await registry.get('deepseek-account')).toBeUndefined()
    script = { ...script, revision: 4, status: 'valid' }
    expect((await registry.get('deepseek-account'))?.totalBalance).toBe(123.45)
    expect(deps.resolveIdentity).not.toHaveBeenCalled()
    await registry.stop()
  })
  it('combines same-currency top-ups and bonuses without converting unrelated wallets', () => {
    expect(parseAccountBalance(ready)).toEqual({ currency: 'CNY', toppedUpBalance: 120, grantedBalance: 3.45, totalBalance: 123.45, isAvailable: true })
    expect(parseAccountBalance({ ...ready, value: [...ready.value, { currency: 'USD', balance: '99.00' }] })?.totalBalance).toBe(123.45)
    expect(parseAccountBalance({ status: 'ready', value: [], bonusWallets: [{ currency: 'USD', balance: '2.00' }] })?.currency).toBe('USD')
  })
  it('does not invent zero for unavailable, failed or invalid results', () => {
    for (const raw of [null, { status: 'failed' }, { ...ready, value: [] , bonusWallets: [] },
      { ...ready, value: [{ currency: 'CNY', balance: '' }] }, { ...ready, value: [{ currency: 'CNY', balance: 'Infinity' }] }]) {
      expect(parseAccountBalance(raw)).toBeUndefined()
    }
    expect(parseAccountBalance({ ...ready, value: [{ currency: 'CNY', balance: '-5.00' }] })?.totalBalance).toBe(-1.55)
  })
  it('queries each time, including after failures, with no credential lookup or script fallback', async () => {
    const read = vi.fn().mockResolvedValueOnce(ready).mockResolvedValueOnce({ status: 'failed' }).mockResolvedValueOnce(ready)
    const account = new AccountBalanceSource(read)
    const deps = { readScript: vi.fn().mockResolvedValue({ revision: 0, status: 'valid' }), resolveIdentity: vi.fn(), request: vi.fn() }
    const registry = new BalanceRegistry(deps)
    registry.setAccountSource(account)
    expect((await registry.get('deepseek-account'))?.totalBalance).toBe(123.45)
    expect(await registry.get('deepseek-account')).toBeUndefined()
    expect((await registry.get('deepseek-account'))?.totalBalance).toBe(123.45)
    expect(read).toHaveBeenCalledTimes(3)
    expect(deps.resolveIdentity).not.toHaveBeenCalled()
    expect(deps.readScript).toHaveBeenCalled()
    expect(deps.request).not.toHaveBeenCalled()
    await registry.stop()
    expect(await registry.get('deepseek-account')).toBeUndefined()
  })
  it('fails closed without the native service, even if an API key might exist', async () => {
    const deps = { readScript: vi.fn().mockResolvedValue({ revision: 0, status: 'valid' }), resolveIdentity: vi.fn(), request: vi.fn() }
    expect(await new BalanceRegistry(deps).get('deepseek-account')).toBeUndefined()
    expect(deps.resolveIdentity).not.toHaveBeenCalled()
  })
  it('aborts API-key requests immediately even while native teardown is pending', async () => {
    let finishNative!: (value: unknown) => void
    let finishKey!: (value: unknown) => void
    const account = new AccountBalanceSource(() => new Promise(resolve => { finishNative = resolve }))
    const request = vi.fn((_descriptor, _baseURL, _apiKey, _signal: AbortSignal) => new Promise(resolve => { finishKey = resolve }))
    const registry = new BalanceRegistry({
      readScript: async () => ({ provider: 'key', revision: 1, status: 'valid', script: '', request: { path: '/user/balance', method: 'GET', auth: 'bearer' } }),
      resolveIdentity: async () => ({ apiKey: 'synthetic-key', baseURL: 'https://api.deepseek.com' }), request,
    })
    registry.setAccountSource(account)
    const native = registry.get('deepseek-account')
    const key = registry.get('key')
    await vi.waitFor(() => expect(request).toHaveBeenCalledOnce())
    const stopping = registry.stop()
    expect(request.mock.calls[0][3].aborted).toBe(true)
    finishKey(undefined)
    finishNative(ready)
    await stopping
    expect(await native).toBeUndefined()
    expect(await key).toBeUndefined()
  })
  it('coalesces pending work and drops stale responses across credential changes and disposal', async () => {
    let complete!: (value: unknown) => void
    const read = vi.fn().mockImplementationOnce(() => new Promise(resolve => { complete = resolve })).mockResolvedValue(ready)
    const account = new AccountBalanceSource(read)
    const first = account.get()
    const second = account.get()
    await Promise.resolve()
    expect(read).toHaveBeenCalledTimes(1)
    account.invalidate()
    const next = await account.get()
    complete(ready)
    expect(await first).toBeUndefined()
    expect(await second).toBeUndefined()
    expect(next?.totalBalance).toBe(123.45)
    account.invalidate()
    expect((await account.get())?.credentialGeneration).not.toBe(next?.credentialGeneration)
    await account.stop()
    expect(await account.get()).toBeUndefined()
  })
})
