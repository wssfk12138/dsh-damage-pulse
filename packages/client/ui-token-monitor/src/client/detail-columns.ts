/** Stable presentation order; saved preferences never alter request filters. */
export const detailColumns = ['model', 'session', 'provider', 'project', 'tokens', 'reasoningTokens', 'reasoningEffort', 'fee', 'latency', 'time', 'status'] as const
/** Column identifiers accepted by the persisted visibility preference. */
export type DetailColumn = typeof detailColumns[number]
/** Columns displayed before the user customizes visibility. */
export const defaultColumns: readonly DetailColumn[] = ['model', 'session', 'tokens', 'fee', 'latency', 'time', 'status']
/** Browser storage key for usage column visibility. */
export const columnsKey = 'dsh-token-monitor.detail-columns'
/** Ignore stale ids and retain useful identity columns when storage is empty or invalid.
 * @returns Visible columns in presentation order.
 */
export function readColumns(): DetailColumn[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(columnsKey) ?? 'null')
    if (Array.isArray(value)) {
      const valid = detailColumns.filter(id => value.includes(id))
      return valid.some(id => id !== 'status') ? valid : ['model', 'time']
    }
  } catch { /* Viewing preferences must not block access to usage. */ }
  return [...defaultColumns]
}
