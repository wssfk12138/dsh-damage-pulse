import { expect, it } from 'vitest'
import { comparableBalances } from '../src/client/balanceMath.ts'
import type { BalanceInfo } from '../src/client/types.ts'

const snapshot: BalanceInfo = { provider: 'vendor', scriptRevision: 1, credentialGeneration: 'key-1', currency: 'USD', totalBalance: 0, grantedBalance: 0, toppedUpBalance: 0, isAvailable: true, updatedAt: 1 }

it('compares successive amounts only within one balance identity', () => {
  expect(comparableBalances(snapshot, { ...snapshot, totalBalance: 10, updatedAt: 2 })).toBe(true)
  for (const changed of [{ provider: 'other' }, { currency: 'CNY' }, { scriptRevision: 2 }, { credentialGeneration: 'key-2' }]) {
    expect(comparableBalances(snapshot, { ...snapshot, ...changed, totalBalance: 10 })).toBe(false)
  }
  expect(comparableBalances(null, snapshot)).toBe(false)
})
