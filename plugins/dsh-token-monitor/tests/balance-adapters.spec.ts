import { describe, expect, it } from 'vitest'
import { BUILT_IN_BALANCE_ADAPTERS, builtInBalanceAdapter, FASTAI_BALANCE_SCRIPT } from '../src/balance-adapters.ts'
import { evaluateBalanceScript, validateBalanceRequest, validateScriptBalance } from '../src/balance-script.ts'
import { refuseScriptLiteral } from '../src/script-literals.ts'

describe('built-in balance adapters', () => {
  it('matches a known gateway on a label boundary only', () => {
    expect(builtInBalanceAdapter('https://www.fastaitoken.com')).toMatchObject({ label: 'fastaitoken' })
    expect(builtInBalanceAdapter('https://FASTAITOKEN.com/')).toMatchObject({ label: 'fastaitoken' })
    expect(builtInBalanceAdapter('https://api.fastaitoken.com/v1')).toMatchObject({ label: 'fastaitoken' })
    expect(builtInBalanceAdapter('https://api.deepseek.com')).toMatchObject({ label: 'DeepSeek' })
    expect(builtInBalanceAdapter('https://fastaitoken.com.evil.example')).toBeUndefined()
    expect(builtInBalanceAdapter('https://notfastaitoken.com')).toBeUndefined()
    expect(builtInBalanceAdapter('https://relay.example')).toBeUndefined()
    expect(builtInBalanceAdapter('not a url')).toBeUndefined()
  })

  it('ships only keyless adapters that pass the source policy and name their own approved GET target', async () => {
    for (const adapter of BUILT_IN_BALANCE_ADAPTERS) {
      expect(refuseScriptLiteral(adapter.script), adapter.label).toBeUndefined()
      expect(adapter.endpoint.method, adapter.label).toBe('GET')
      expect(await evaluateBalanceScript(adapter.script), adapter.label).toBeDefined()
      expect(validateBalanceRequest(await evaluateBalanceScript(adapter.script)), adapter.label).toMatchObject({
        path: adapter.endpoint.path,
        method: adapter.endpoint.method,
      })
    }
  })

  it('parses the fastaitoken usage payload into a bounded balance', async () => {
    expect(validateScriptBalance(await evaluateBalanceScript(FASTAI_BALANCE_SCRIPT, { remaining: 12.5, unit: 'usd', is_active: true })))
      .toMatchObject({ currency: 'USD', totalBalance: 12.5, isAvailable: true })
    expect(validateScriptBalance(await evaluateBalanceScript(FASTAI_BALANCE_SCRIPT, { quota: { remaining: 300, unit: 'credits' } })))
      .toMatchObject({ currency: 'credits', totalBalance: 300 })
  })
})
