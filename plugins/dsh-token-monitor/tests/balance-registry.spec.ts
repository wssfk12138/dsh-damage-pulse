import { describe, expect, it, vi } from 'vitest'
import { BalanceRegistry } from '../src/balance-registry.ts'
import { OFFICIAL_BALANCE_SCRIPT, validateBalanceRequest, evaluateBalanceScript } from '../src/balance-script.ts'

const raw = { balance_infos: [{ currency: 'CNY', total_balance: '12', granted_balance: '0', topped_up_balance: '12' }] }
async function setup() {
  let identity = { apiKey: 'key-a', baseURL: 'https://api.deepseek.com' }
  const script = { provider: 'a', revision: 1, script: OFFICIAL_BALANCE_SCRIPT, status: 'valid' as const, request: validateBalanceRequest(await evaluateBalanceScript(OFFICIAL_BALANCE_SCRIPT)) }
  const request = vi.fn(async () => raw)
  const registry = new BalanceRegistry({ readScript: async () => script, resolveIdentity: async () => identity, request })
  return { registry, request, script, rotate: () => { identity = { ...identity, apiKey: 'key-b' } } }
}
describe('provider balance registry', () => {
  it('waits for invalidated network work before finishing teardown', async () => {
    const { registry, request } = await setup()
    let finish!: (value: typeof raw) => void
    request.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const balance = registry.get('a')
    await vi.waitFor(() => expect(request).toHaveBeenCalledOnce())
    registry.invalidate('a')
    let stopped = false
    const stopping = registry.stop().then(() => { stopped = true })
    await Promise.resolve()
    expect(stopped).toBe(false)
    expect(await registry.get('a')).toBeUndefined()
    finish(raw)
    await stopping
    expect(await balance).toBeUndefined()
    expect(stopped).toBe(true)
  })
  it('waits for credential lookup and never sends a request after teardown starts', async () => {
    const { script } = await setup()
    let finish!: (value: undefined) => void
    const resolveIdentity = vi.fn(() => new Promise<undefined>(resolve => { finish = resolve }))
    const request = vi.fn()
    const registry = new BalanceRegistry({ readScript: async () => script, resolveIdentity, request })
    const balance = registry.get('a')
    await vi.waitFor(() => expect(resolveIdentity).toHaveBeenCalledOnce())
    let stopped = false
    const stopping = registry.stop().then(() => { stopped = true })
    await Promise.resolve()
    expect(stopped).toBe(false)
    finish(undefined)
    await stopping
    expect(await balance).toBeUndefined()
    expect(request).not.toHaveBeenCalled()
  })
  it('does not start a query when a script is invalidated during credential lookup', async () => {
    const { script } = await setup()
    let release!: (value: { apiKey: string; baseURL: string }) => void
    const identity = new Promise<{ apiKey: string; baseURL: string }>(resolve => { release = resolve })
    const request = vi.fn(async () => raw)
    const resolveIdentity = vi.fn(() => identity)
    const registry = new BalanceRegistry({ readScript: async () => script, resolveIdentity, request })
    const pending = registry.get('a')
    await vi.waitFor(() => expect(resolveIdentity).toHaveBeenCalledOnce())
    registry.invalidate('a')
    release({ apiKey: 'key-a', baseURL: 'https://api.deepseek.com' })
    expect(await pending).toBeUndefined()
    expect(request).not.toHaveBeenCalled()
    expect(await registry.get('a')).toMatchObject({ totalBalance: 12 })
    registry.stop()
  })
  it('coalesces requests and invalidates cached credentials on rotation', async () => {
    const { registry, request, rotate } = await setup()
    const [a, b] = await Promise.all([registry.get('a'), registry.get('a')])
    expect(a).toEqual(b)
    expect(request).toHaveBeenCalledTimes(1)
    rotate()
    const c = await registry.get('a')
    expect(c?.credentialGeneration).not.toBe(a?.credentialGeneration)
    expect(request).toHaveBeenCalledTimes(2)
    registry.stop()
    expect(await registry.get('a')).toBeUndefined()
  })
  it('discards an old response if credentials rotate during the query', async () => {
    const { registry, request, rotate } = await setup()
    request.mockImplementationOnce(async () => { rotate(); return raw })
    expect(await registry.get('a')).toBeUndefined()
    expect(await registry.get('a')).toMatchObject({ totalBalance: 12 })
  })
  it('passes the Host-private endpoint separately from the path-only script request', async () => {
    const { registry, request } = await setup()
    await registry.get('a')
    expect(request).toHaveBeenCalledWith(expect.objectContaining({ path: '/user/balance' }),
      'https://api.deepseek.com', 'key-a', expect.any(AbortSignal))
  })
})
