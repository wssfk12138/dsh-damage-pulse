/** Authenticated module management transport; failures never substitute mock state. */
import type { ModuleSnapshot, ModuleUninstallRequest, ModuleRestorePlan, ModuleRestoreRequest, ModuleUpdateStatus } from '@deepseek-ai/dsh-token-monitor-contract'

type JsonObject = Record<string, unknown>
const object = (value: unknown): value is JsonObject => value !== null && typeof value === 'object' && !Array.isArray(value)
const version = (value: unknown): value is string => typeof value === 'string' && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)
const moduleId = (value: unknown): value is string => typeof value === 'string' && /^[a-z][a-z0-9-]{0,47}$/.test(value) && !['core', 'plugin', 'constructor', 'prototype'].includes(value)
const flag = (value: unknown): value is boolean => typeof value === 'boolean'
const snapshot = (value: unknown): value is ModuleSnapshot => object(value) && value.schemaVersion === 1
  && Number.isSafeInteger(value.revision) && (value.revision as number) >= 0 && version(value.version)
  && flag(value.pluginRemoved) && flag(value.restartRequired) && Array.isArray(value.modules) && value.modules.length <= 64
  && (value.cleanupPending === undefined || flag(value.cleanupPending))
  && (value.cleanupErrors === undefined || Array.isArray(value.cleanupErrors) && value.cleanupErrors.length <= 65 && value.cleanupErrors.every(code => typeof code === 'string' && /^[A-Z0-9_]{1,100}$/.test(code)))
  && value.modules.every(item => object(item) && moduleId(item.id) && flag(item.autoInstallBlocked)
    && ['installed', 'removed', 'pending-delete', 'unavailable'].includes(item.status as string))
  && new Set(value.modules.map(item => item.id)).size === value.modules.length
const update = (value: unknown): value is ModuleUpdateStatus => object(value) && version(value.currentVersion)
  && version(value.latestVersion) && flag(value.hasUpdate) && flag(value.compatible)
const plan = (value: unknown): value is ModuleRestorePlan => object(value) && moduleId(value.id)
  && version(value.currentVersion) && version(value.latestVersion) && flag(value.currentAvailable) && flag(value.hasUpdate)

async function request<T>(action: string, validate: (value: unknown) => value is T, body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api/token-monitor/modules${action}`, {
    credentials: 'same-origin', cache: 'no-store', ...(signal ? { signal } : {}),
    ...(body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  })
  const value: unknown = await response.json()
  if (!response.ok) {
    const error = object(value) && object(value.error) ? value.error : undefined
    const code = typeof error?.code === 'string' && /^[A-Z0-9_]{1,100}$/.test(error.code) ? error.code : `HTTP_${response.status}`
    const diagnostic = typeof error?.diagnostic === 'string' && /^[A-Za-z0-9_ .:/|+-]{1,300}$/.test(error.diagnostic) ? error.diagnostic : ''
    throw new Error(diagnostic ? `${code}\n${diagnostic}` : code)
  }
  if (!validate(value)) throw new Error('INVALID_MODULE_RESPONSE')
  return value
}

/** Operations accept an observed revision so stale dialogs cannot overwrite newer choices. */
export const moduleApi = {
  snapshot: (signal?: AbortSignal) => request('', snapshot, undefined, signal),
  uninstall: (body: ModuleUninstallRequest) => request('/uninstall', snapshot, body),
  check: () => request('/check', update, {}),
  update: (expectedRevision: number) => request('/update', snapshot, { expectedRevision }),
  plan: (id: string) => request('/restore-plan', plan, { id }),
  restore: (body: ModuleRestoreRequest) => request('/restore', snapshot, body),
}

/** Framework-bound source shared by every optional UI registration. */
export function createModuleState() {
  let state: ModuleSnapshot | undefined
  let timer: ReturnType<typeof setInterval> | undefined
  let disposed = false
  let pending: Promise<void> | undefined
  let controller: AbortController | undefined
  const listeners = new Set<() => void>()
  const refresh = (): Promise<void> => {
    if (disposed) return Promise.resolve()
    if (pending) return pending
    const current = new AbortController()
    controller = current
    pending = moduleApi.snapshot(current.signal).then((next) => {
      if (disposed || current.signal.aborted || JSON.stringify(next) === JSON.stringify(state)) return
      state = next
      for (const listener of listeners) {
        try { listener() } catch (error) { console.warn('Token monitor module listener failed', error) }
      }
    }).finally(() => { if (controller === current) { pending = undefined; controller = undefined } })
    return pending
  }
  const poll = () => { void refresh().catch(() => { /* Retry transport failures on the next poll. */ }) }
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      if (disposed) return () => {}
      listeners.add(listener)
      if (!timer) { poll(); timer = setInterval(poll, 2000) }
      return () => { listeners.delete(listener); if (!listeners.size) { clearInterval(timer); timer = undefined; controller?.abort() } }
    },
    refresh,
    dispose() { disposed = true; clearInterval(timer); controller?.abort(); listeners.clear() },
  }
}

/** Unknown state keeps only management visible until installation is confirmed. */
export function moduleInstalled(state: ModuleSnapshot | undefined, id: string): boolean {
  return state?.pluginRemoved === false && !state.restartRequired && state.modules.some(module => module.id === id && module.status === 'installed')
}
