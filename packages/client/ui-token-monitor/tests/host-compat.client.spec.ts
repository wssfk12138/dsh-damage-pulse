import { describe, expect, it, vi } from 'vitest'
import {
  HostCompatProtocolError,
  createHostCompatApi,
  hostCompatHint,
  parseHostCompatStatus,
} from '../src/client/hostCompatApi.ts'

const payload = {
  schemaVersion: 1,
  sessionRecords: { capability: 'unsupported', hostVersion: '0.1.7-alpha.2', detail: 'resolved host package', forced: false },
}

describe('host compatibility client', () => {
  it('parses a valid payload', () => {
    expect(parseHostCompatStatus(payload)).toEqual(payload)
  })
  it('rejects an unknown capability and missing fields', () => {
    expect(() => parseHostCompatStatus({ ...payload, sessionRecords: { ...payload.sessionRecords, capability: 'maybe' } })).toThrow(HostCompatProtocolError)
    expect(() => parseHostCompatStatus({ ...payload, sessionRecords: { ...payload.sessionRecords, forced: 'yes' } })).toThrow(HostCompatProtocolError)
    expect(() => parseHostCompatStatus(null)).toThrow(HostCompatProtocolError)
  })
  it('reads the route through fetch', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, json: async () => payload }))
    const status = await createHostCompatApi(fetchImpl as never).status()
    expect(status.sessionRecords.capability).toBe('unsupported')
    expect(fetchImpl).toHaveBeenCalledWith('/api/token-monitor/host-compat', expect.objectContaining({ headers: { accept: 'application/json' } }))
  })
  it('surfaces a non-2xx response as a protocol error', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) }))
    await expect(createHostCompatApi(fetchImpl as never).status()).rejects.toThrow(HostCompatProtocolError)
  })
})

describe('host compatibility hint', () => {
  it('is silent when the host keeps the marker', () => {
    expect(hostCompatHint(parseHostCompatStatus({ ...payload, sessionRecords: { capability: 'supported', detail: 'ok', forced: false } }))).toBeUndefined()
  })
  it('names the detected version, the required line and the ledger fallback', () => {
    const hint = hostCompatHint(parseHostCompatStatus(payload))
    expect(hint).toContain('0.1.7-alpha.2')
    expect(hint).toContain('本地账本')
  })
  it('explains the unknown case with the explicit override', () => {
    const hint = hostCompatHint(parseHostCompatStatus({ ...payload, sessionRecords: { capability: 'unknown', detail: 'no package', forced: false } }))
    expect(hint).toContain('DSH_TOKEN_MONITOR_FORCE_SESSION_RECORDS=1')
  })
})
