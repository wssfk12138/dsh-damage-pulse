import assert from 'node:assert/strict'
import test from 'node:test'
import {
  selectBalanceInfo,
  type BalanceResponse,
} from '../plugins/dsh-token-monitor/src/balance-selection.ts'

function response(balanceInfos: BalanceResponse['balance_infos']): BalanceResponse {
  return { is_available: true, balance_infos: balanceInfos }
}

const cny = {
  currency: 'CNY',
  total_balance: '81.69',
  granted_balance: '1.69',
  topped_up_balance: '80.00',
}

const emptyUsd = {
  currency: 'USD',
  total_balance: '0.00',
  granted_balance: '0.00',
  topped_up_balance: '0.00',
}

test('selects the funded CNY entry regardless of API array order', () => {
  assert.deepEqual(selectBalanceInfo(response([emptyUsd, cny])), {
    currency: 'CNY',
    totalBalance: 81.69,
    grantedBalance: 1.69,
    toppedUpBalance: 80,
  })
  assert.deepEqual(selectBalanceInfo(response([cny, emptyUsd])), {
    currency: 'CNY',
    totalBalance: 81.69,
    grantedBalance: 1.69,
    toppedUpBalance: 80,
  })
})

test('keeps a funded non-CNY account instead of an empty CNY entry', () => {
  const fundedUsd = { ...emptyUsd, total_balance: '12.50', topped_up_balance: '12.50' }
  assert.equal(selectBalanceInfo(response([cnyZero(), fundedUsd])).currency, 'USD')
})

test('uses CNY as the deterministic tie-breaker for empty entries', () => {
  assert.equal(selectBalanceInfo(response([emptyUsd, cnyZero()])).currency, 'CNY')
})

test('keeps a negative DeepSeek overdraft instead of treating it as malformed', () => {
  const overdraft = {
    currency: 'CNY',
    total_balance: '-12.34',
    granted_balance: '0.00',
    topped_up_balance: '-12.34',
  }
  assert.deepEqual(selectBalanceInfo(response([overdraft])), {
    currency: 'CNY',
    totalBalance: -12.34,
    grantedBalance: 0,
    toppedUpBalance: -12.34,
  })
})


test('rejects missing entries instead of fabricating a zero balance', () => {
  assert.throws(() => selectBalanceInfo(response([])), /no valid balance_infos/)
})

test('ignores a malformed secondary entry when a valid balance remains', () => {
  assert.equal(
    selectBalanceInfo(response([{ ...cny, total_balance: 'not-a-number' }, emptyUsd])).currency,
    'USD',
  )
})

test('rejects a response with no valid amounts instead of leaking NaN into the client', () => {
  assert.throws(
    () => selectBalanceInfo(response([{ ...cny, total_balance: 'not-a-number' }])),
    /no valid balance_infos/,
  )
})

function cnyZero() {
  return { ...emptyUsd, currency: 'CNY' }
}
