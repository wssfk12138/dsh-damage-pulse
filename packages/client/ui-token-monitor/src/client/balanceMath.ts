/**
 * Apply one queued debit to the local visual balance without hiding overdraft.
 * @param previous - Current displayed balance, or null when no balance is available.
 * @param debit - Non-negative amount to subtract from the displayed balance.
 * @returns The updated display balance, preserving null or invalid-debit input unchanged.
 */
export function applyDebitToDisplay(previous: number | null, debit: number): number | null {
  if (previous === null || !Number.isFinite(debit) || debit < 0) return previous
  return previous - debit
}
import type { BalanceInfo } from './types.ts'

/** Compare only snapshots returned by the same provider configuration and credential.
 * @param previous Previously accepted balance, or null after an unavailable response.
 * @param current New authoritative balance.
 * @returns Whether their amounts describe the same balance source and currency.
 */
export function comparableBalances(previous: BalanceInfo | null, current: BalanceInfo): previous is BalanceInfo {
  return previous !== null && previous.provider === current.provider
    && previous.currency === current.currency && previous.scriptRevision === current.scriptRevision
    && previous.credentialGeneration === current.credentialGeneration
}
