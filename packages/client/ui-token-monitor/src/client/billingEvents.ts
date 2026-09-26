/** Authenticated billing snapshots exposed to the slot renderer as one observable source. */
import { validateBillingRules, type BillingSnapshot } from '@deepseek-ai/dsh-token-monitor-contract'

/** Validate HTTP and event-stream snapshots before exposing them to the editor.
 * @param value Untrusted response.
 * @returns Validated current rules and revision.
 */
export function readBillingSnapshot(value: unknown): BillingSnapshot {
  if (!value || typeof value !== 'object' || !('revision' in value) || !('rules' in value)
    || typeof value.revision !== 'number' || !Number.isSafeInteger(value.revision) || value.revision < 0) {
    throw new TypeError('Invalid billing snapshot')
  }
  return { revision: value.revision, rules: validateBillingRules(value.rules) }
}

/** Latest validated stream value; malformed messages leave the previous value available. */
export interface BillingEventsState { snapshot?: BillingSnapshot; invalid: boolean }

/** Create a lazy stream owned by the plugin and subscribed by the slot renderer.
 * @returns Stable observable source and its plugin disposal callback.
 */
export function createBillingEvents(): {
  getSnapshot: () => BillingEventsState
  subscribe: (listener: () => void) => () => void
  dispose: () => void
  setEnabled: (enabled: boolean) => void
} {
  let state: BillingEventsState = { invalid: false }
  let events: EventSource | undefined
  let enabled = true
  let disposed = false
  const listeners = new Set<() => void>()
  const close = () => { events?.close(); events = undefined }
  const publish = (next: BillingEventsState) => {
    if (JSON.stringify(next) === JSON.stringify(state)) return
    state = next
    for (const notify of listeners) {
      try { notify() } catch (error) { console.error('Billing subscriber failed', error) }
    }
  }
  const connect = () => {
    if (disposed || !enabled || events || !listeners.size) return
    const current = events = new EventSource('/api/token-monitor/billing/events')
    current.onmessage = (event) => {
      if (events !== current || disposed || !enabled) return
      let next: BillingEventsState
      try {
        if (typeof event.data !== 'string') throw new TypeError('Invalid billing event')
        next = { snapshot: readBillingSnapshot(JSON.parse(event.data)), invalid: false }
      } catch { next = { ...state, invalid: true } }
      publish(next)
    }
  }
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      if (disposed) return () => {}
      listeners.add(listener)
      connect()
      return () => { listeners.delete(listener); if (!listeners.size) close() }
    },
    setEnabled(value) {
      if (disposed) return
      enabled = value
      if (!enabled) { close(); publish({ invalid: false }) }
      else connect()
    },
    dispose() { disposed = true; listeners.clear(); close() },
  }
}
