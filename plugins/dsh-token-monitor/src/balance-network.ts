/** Credential-bearing transport with public-address DNS pinning and no redirects. */
import { lookup } from 'node:dns/promises'
import { request as httpsRequest } from 'node:https'
import ipaddr from 'ipaddr.js'
import { MAX_BALANCE_RESPONSE_BYTES, validateBalanceRequest, type BalanceRequest } from './balance-script.ts'

/** Fake-IP range handed back by TUN proxies (Mihomo/Clash default, RFC 2544 space). */
const FAKE_IP_V4 = ipaddr.IPv4.parseCIDR('198.18.0.0/15')

/** Accept only globally routable unicast addresses, including mapped IPv4 checks.
 * @param address Resolved numeric address.
 * @returns Whether the address may receive provider credentials.
 */
export function publicBalanceAddress(address: string): boolean {
  if (!ipaddr.isValid(address)) return false
  const parsed = ipaddr.process(address)
  return parsed.range() === 'unicast'
}

/** Accept the one Fake-IP range a TUN proxy substitutes for an ordinary public domain.
 * Only native IPv4 answers qualify; IPv4-mapped IPv6 forms and every other reserved range
 * stay refused, so this is not a general allowance for non-public destinations.
 * @param address Resolved numeric address.
 * @returns Whether the address is the IPv4 Fake-IP candidate range.
 */
export function fakeIpBalanceAddress(address: string): boolean {
  if (!ipaddr.isValid(address) || !ipaddr.IPv4.isValid(address)) return false
  const parsed = ipaddr.process(address)
  return parsed.kind() === 'ipv4' && parsed.match(FAKE_IP_V4)
}

/** Backoff-relevant transport classification; never carries host, path or credential data. */
export type BalanceNetworkFailure = 'blocked' | 'rate-limited'

/** An HTTP response outside 2xx, carrying only the status so callers can classify it. */
export class BalanceHttpError extends Error {
  /** @param status Status code returned by the provider. */
  constructor(readonly status: number) {
    super('Balance HTTP ' + String(status))
    this.name = 'BalanceHttpError'
  }
}

/** Ordinary transport results stay plain errors and keep the short-recovery backoff, while an
 * explicit upstream wait or a policy refusal is surfaced so the caller can classify the failure.
 */
export class BalanceNetworkError extends Error {
  /** @param kind Backoff-relevant classification.
   * @param message Fixed message without provider or network details.
   * @param retryAfterMs Explicit upstream wait, already bounded, when the provider asked for one.
   */
  constructor(readonly kind: BalanceNetworkFailure, message: string, readonly retryAfterMs?: number) {
    super(message)
    this.name = 'BalanceNetworkError'
  }
}

/** Read an explicit provider wait so a requested pause is never shortened to the default.
 * @param headers Response headers from the provider.
 * @returns Bounded retry delay in milliseconds, or undefined when absent or unusable.
 */
function retryAfterMs(headers: Record<string, string | string[] | undefined>): number | undefined {
  const raw = headers['retry-after']
  const value = Array.isArray(raw) ? raw[0] : raw
  if (typeof value !== 'string' || value.trim() === '') return undefined
  const seconds = Number(value.trim())
  const delay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - Date.now()
  if (!Number.isFinite(delay) || delay <= 0) return undefined
  return Math.min(Math.max(delay, 15_000), 1_800_000)
}

/** Query one Host-resolved destination; scripts never receive its origin, key or raw headers.
 * @param descriptor Validated path-only request entry.
 * @param baseURL Host-private provider endpoint.
 * @param apiKey Current provider credential, attached only after DNS checks.
 * @param signal Cancellation on provider/script/key changes or shutdown.
 * @returns Bounded parsed JSON response.
 */
export async function requestBalanceJson(descriptor: BalanceRequest, baseURL: string, apiKey: string, signal: AbortSignal): Promise<unknown> {
  const allowed = validateBalanceRequest(descriptor)
  const base = new URL(baseURL)
  if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash
    || (base.port !== '' && base.port !== '443') || base.hostname.endsWith('.')) {
    throw new Error('Balance provider endpoint must be exact HTTPS')
  }
  const url = new URL(allowed.path, base.origin)
  // Fake-IP substitution applies only to a domain target; literal addresses keep the original rule.
  const domainTarget = !ipaddr.isValid(url.hostname.replace(/^\[|\]$/g, ''))
  const boundedSignal = AbortSignal.any([signal, AbortSignal.timeout(10_000)])
  let cancelLookup: (() => void) | undefined
  const records = await Promise.race([lookup(url.hostname.replace(/^\[|\]$/g, ''), { all: true, verbatim: true }),
    new Promise<never>((_, reject) => {
      cancelLookup = () => reject(new Error('Balance request cancelled'))
      if (boundedSignal.aborted) cancelLookup()
      else boundedSignal.addEventListener('abort', cancelLookup, { once: true })
    })]).finally(() => { if (cancelLookup) boundedSignal.removeEventListener('abort', cancelLookup) })
  boundedSignal.throwIfAborted()
  // A TUN proxy answers ordinary domains with its Fake-IP range; any other non-public answer stays refused.
  const acceptable = (address: string): boolean => publicBalanceAddress(address)
    || (domainTarget && fakeIpBalanceAddress(address))
  if (records.length === 0 || records.some(record => !acceptable(record.address))) throw new BalanceNetworkError('blocked', 'Balance destination must resolve to public or supported Fake-IP addresses')
  const pinned = records[0]!
  return new Promise((resolve, reject) => {
    const req = httpsRequest(url, {
      method: allowed.method, agent: false, signal: boundedSignal,
      // Keep original hostname for TLS validation; the socket uses this exact checked address.
      lookup: (_hostname, options, callback) => {
        // Answer on a later tick on purpose: node starts connecting inside this callback, and a
        // connect errno raised there destroys the socket before the request has attached its
        // listeners. That error then reaches the process as an unhandled 'error' event and ends
        // the host, so the pinned answer is never handed over in node's own connect stack.
        setImmediate(() => {
          if (options.all) callback(null, [pinned])
          else callback(null, pinned.address, pinned.family)
        })
      },
      headers: { Accept: 'application/json', 'Accept-Encoding': 'identity',
        ...(allowed.auth === 'bearer' ? { Authorization: `Bearer ${apiKey}` } : { 'x-api-key': apiKey }),
        ...(allowed.body === undefined ? {} : { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(allowed.body) }) },
    }, res => {
      const status = res.statusCode ?? 0
      if (status < 200 || status >= 300) {
        res.destroy()
        // A 429 keeps the provider's own wait so the query never polls harder than requested.
        const wait = status === 429 ? retryAfterMs(res.headers) : undefined
        reject(wait === undefined ? new BalanceHttpError(status) : new BalanceNetworkError('rate-limited', `Balance HTTP ${status}`, wait))
        return
      }
      if (res.headers['content-encoding'] && res.headers['content-encoding'] !== 'identity') {
        res.destroy(); reject(new Error('Compressed balance responses are unsupported')); return
      }
      let size = 0
      const chunks: Buffer[] = []
      res.on('data', (chunk: Buffer) => {
        size += chunk.length
        if (size > MAX_BALANCE_RESPONSE_BYTES) { res.destroy(); reject(new Error('Balance response exceeds 256 KiB')); return }
        chunks.push(chunk)
      })
      res.on('error', () => reject(new Error('Balance response interrupted')))
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown) }
        catch { reject(new Error('Balance response is not JSON')) }
      })
    })
    req.on('error', () => reject(new Error('Balance network request failed or timed out')))
    // The same failure mode at socket level stays contained as well, so a connect error can only
    // ever surface as this promise's rejection and the caller's ordinary backoff.
    req.on('socket', socket => socket.on('error', () => {}))
    req.end(allowed.body)
  })
}
