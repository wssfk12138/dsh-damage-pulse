/** Credential-bearing transport with public-address DNS pinning and no redirects. */
import { lookup } from 'node:dns/promises'
import { request as httpsRequest } from 'node:https'
import ipaddr from 'ipaddr.js'
import { MAX_BALANCE_RESPONSE_BYTES, validateBalanceRequest, type BalanceRequest } from './balance-script.ts'

/** Accept only globally routable unicast addresses, including mapped IPv4 checks.
 * @param address Resolved numeric address.
 * @returns Whether the address may receive provider credentials.
 */
export function publicBalanceAddress(address: string): boolean {
  if (!ipaddr.isValid(address)) return false
  const parsed = ipaddr.process(address)
  return parsed.range() === 'unicast'
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
  const boundedSignal = AbortSignal.any([signal, AbortSignal.timeout(10_000)])
  let cancelLookup: (() => void) | undefined
  const records = await Promise.race([lookup(url.hostname.replace(/^\[|\]$/g, ''), { all: true, verbatim: true }),
    new Promise<never>((_, reject) => {
      cancelLookup = () => reject(new Error('Balance request cancelled'))
      if (boundedSignal.aborted) cancelLookup()
      else boundedSignal.addEventListener('abort', cancelLookup, { once: true })
    })]).finally(() => { if (cancelLookup) boundedSignal.removeEventListener('abort', cancelLookup) })
  boundedSignal.throwIfAborted()
  if (records.length === 0 || records.some(record => !publicBalanceAddress(record.address))) throw new Error('Balance destination must resolve exclusively to public addresses')
  const pinned = records[0]!
  return new Promise((resolve, reject) => {
    const req = httpsRequest(url, {
      method: allowed.method, agent: false, signal: boundedSignal,
      // Keep original hostname for TLS validation; the socket uses this exact checked address.
      lookup: (_hostname, options, callback) => {
        if (options.all) callback(null, [pinned])
        else callback(null, pinned.address, pinned.family)
      },
      headers: { Accept: 'application/json', 'Accept-Encoding': 'identity',
        ...(allowed.auth === 'bearer' ? { Authorization: `Bearer ${apiKey}` } : { 'x-api-key': apiKey }),
        ...(allowed.body === undefined ? {} : { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(allowed.body) }) },
    }, res => {
      const status = res.statusCode ?? 0
      if (status < 200 || status >= 300) {
        res.destroy()
        reject(new Error(`Balance HTTP ${status}`))
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
    req.end(allowed.body)
  })
}
