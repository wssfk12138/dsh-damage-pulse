/** Keyless balance adapters evaluated inside a bounded QuickJS WebAssembly runtime. */
import { getQuickJS } from 'quickjs-emscripten'
import { validateBalancePath } from './balance-path.ts'
export { validateBalancePath } from './balance-path.ts'

export const MAX_BALANCE_SCRIPT_BYTES = 32_768
export const MAX_BALANCE_RESPONSE_BYTES = 262_144

/** One credential-bearing request path, resolved against a Host-private provider endpoint. */
export interface BalanceRequest { path: string; method: 'GET' | 'POST'; auth: 'bearer' | 'x-api-key'; body?: string }
/** Validated script output; credits remain distinct from monetary currencies. */
export interface ScriptBalance { currency: string; totalBalance: number; grantedBalance: number; toppedUpBalance: number; isAvailable: boolean }

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected an object')
  return value as Record<string, unknown>
}

/** Run one adapter phase with no Node, environment, module loader, timers or network globals.
 * @param script Complete expression returning { request, parse(response) }.
 * @param response JSON response for parsing; omitted when inspecting the request.
 * @returns JSON copied out of the isolated interpreter.
 */
export async function evaluateBalanceScript(script: string, response?: unknown): Promise<unknown> {
  if (Buffer.byteLength(script, 'utf8') > MAX_BALANCE_SCRIPT_BYTES) throw new Error('Balance script exceeds 32 KiB')
  const quickjs = await getQuickJS()
  const runtime = quickjs.newRuntime()
  runtime.setMemoryLimit(8 * 1024 * 1024)
  runtime.setMaxStackSize(256 * 1024)
  const deadline = Date.now() + 100
  runtime.setInterruptHandler(() => Date.now() >= deadline)
  const vm = runtime.newContext()
  try {
    const responseJson = response === undefined ? undefined : JSON.stringify(response)
    if (responseJson !== undefined && Buffer.byteLength(responseJson) > MAX_BALANCE_RESPONSE_BYTES) throw new Error('Balance response exceeds 256 KiB')
    const value = vm.evalCode(`"use strict"; (() => {
      const adapter = (${script}\n);
      if (!adapter || typeof adapter.parse !== 'function') throw new Error('Expected request and parse(response)');
      const result = ${responseJson === undefined ? 'adapter.request' : `adapter.parse(${responseJson})`};
      if (result && typeof result.then === 'function') throw new Error('Async adapters are unsupported');
      return JSON.stringify(result);
    })()`, 'balance-adapter.js')
    if (value.error) {
      // Do not dump untrusted error messages, which may contain response secrets.
      value.error.dispose()
      throw new Error('Balance script failed validation or exceeded execution limits')
    }
    try {
      const json = vm.getString(value.value)
      if (Buffer.byteLength(json) > MAX_BALANCE_RESPONSE_BYTES) throw new Error('Balance script output is too large')
      return JSON.parse(json) as unknown
    } finally { value.value.dispose() }
  } finally { vm.dispose(); runtime.dispose() }
}

/** Validate the relative request path before Host resolves its private HTTPS endpoint.
 * @param value Untrusted request descriptor from the interpreter.
 * @returns Canonical bounded request.
 */
export function validateBalanceRequest(value: unknown): BalanceRequest {
  const item = object(value)
  if (Object.keys(item).some(key => !['path', 'method', 'auth', 'body'].includes(key))) throw new Error('Unsupported balance request field')
  const path = validateBalancePath(item.path)
  if (item.method !== 'GET' && item.method !== 'POST') throw new Error('Balance request must use GET or POST')
  if (item.auth !== 'bearer' && item.auth !== 'x-api-key') throw new Error('Unsupported balance authentication')
  if (item.body !== undefined && (typeof item.body !== 'string' || Buffer.byteLength(item.body) > 8192 || item.method !== 'POST')) throw new Error('Invalid balance request body')
  return { path, method: item.method, auth: item.auth, ...(item.body === undefined ? {} : { body: item.body as string }) }
}

function amount(value: unknown): number {
  if ((typeof value !== 'number' && typeof value !== 'string') || (typeof value === 'string' && !/^-?\d+(?:\.\d+)?$/.test(value))) throw new Error('Balance amount must be a decimal number')
  const result = Number(value)
  if (!Number.isFinite(result) || Math.abs(result) > 1e12) throw new Error('Balance amount is out of range')
  return result
}

/** Validate amounts without coercing credits into a monetary currency.
 * @param value Untrusted adapter result.
 * @returns Bounded balance fields for the UI.
 */
export function validateScriptBalance(value: unknown): ScriptBalance {
  const item = object(value)
  if (typeof item.currency !== 'string' || !/^(?:[A-Z]{3}|credits)$/.test(item.currency)) throw new Error('Balance currency must be an ISO code or credits')
  if (item.isAvailable !== undefined && typeof item.isAvailable !== 'boolean') throw new Error('Invalid balance availability')
  return { currency: item.currency, totalBalance: amount(item.totalBalance),
    grantedBalance: item.grantedBalance === undefined ? 0 : amount(item.grantedBalance),
    toppedUpBalance: item.toppedUpBalance === undefined ? 0 : amount(item.toppedUpBalance),
    isAvailable: item.isAvailable !== false }
}

/** Official adapter seed; an explicitly empty saved script disables it. */
export const OFFICIAL_BALANCE_SCRIPT = `({
  request: { path: "/user/balance", method: "GET", auth: "bearer" },
  parse(response) {
    const rows = response.balance_infos.filter(item => item && typeof item.currency === "string"
      && [item.total_balance, item.granted_balance, item.topped_up_balance].every(value => typeof value === "string" && value.trim() && Number.isFinite(Number(value))));
    rows.sort((a, b) => Number(Number(b.total_balance) > 0) - Number(Number(a.total_balance) > 0)
      || Number(b.currency === "CNY") - Number(a.currency === "CNY")
      || Number(b.total_balance) - Number(a.total_balance) || a.currency.localeCompare(b.currency));
    const row = rows[0];
    return { currency: row.currency, totalBalance: row.total_balance,
      grantedBalance: row.granted_balance, toppedUpBalance: row.topped_up_balance,
      isAvailable: response.is_available !== false };
  }
})`
