import { describe, expect, it, vi } from 'vitest'
import type { Session } from '@deepseek-ai/dsh-session'
import {
  FORCE_SESSION_RECORDS_ENV,
  IGNORABLE_FORWARD_PATTERN,
  SessionRecordWriter,
  capabilityForHostImplementation,
} from '../src/session-records.ts'
import type { UsageRecord } from '../src/types.ts'

const record = {
  sessionId: 'session-record-writer', turn: 1, step: 1, sourceEventSeq: 1, timestamp: 0,
  provider: 'deepseek-official', model: 'deepseek-v4-flash',
  inputTokens: 1, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0,
  cost: 0, costInput: 0, costOutput: 0, costCache: 0, costCacheRead: 0, costCacheWrite: 0,
  peak: false, billingStatus: 'priced',
} as unknown as UsageRecord

/** harness 源码里转发标记的形态。 */
const forwarded = 'surfaceMetadata = { ...surfaceOpts?.ignorable === void 0 ? {} : { ignorable: surfaceOpts.ignorable }, ...surfaceOpts?.surfaceOp === void 0 ? {} : { surfaceOp: surfaceOpts.surfaceOp } }'
/** 已发布 0.1.7-alpha.2 / 0.1.7-rc.2 的形态：只有 sourceEventSeqs 与 surfaceOp。 */
const dropped = 'surfaceMetadata = { ...surfaceOpts?.sourceEventSeqs === void 0 ? {} : { sourceEventSeqs: surfaceOpts.sourceEventSeqs }, ...surfaceOpts?.surfaceOp === void 0 ? {} : { surfaceOp: surfaceOpts.surfaceOp } }'

const readHost = (source?: string, version?: string) => () => ({
  entry: '/profile/node_modules/@deepseek-ai/dsh-session/lib/index.js',
  ...version === undefined ? {} : { version },
  ...source === undefined ? {} : { source },
  detail: 'test implementation',
})

describe('host implementation probe', () => {
  it('recognises forwarding only when the metadata carries ignorable', () => {
    expect(IGNORABLE_FORWARD_PATTERN.test(forwarded)).toBe(true)
    expect(IGNORABLE_FORWARD_PATTERN.test(dropped)).toBe(false)
  })
  it('treats the published shape as unsupported and names the version', () => {
    const verdict = capabilityForHostImplementation({ entry: '/x/lib/index.js', version: '0.1.7-rc.2', source: dropped, detail: 'test' })
    expect(verdict.capability).toBe('unsupported')
    expect(verdict.detail).toContain('0.1.7-rc.2')
  })
  it('accepts a host that forwards the marker', () => {
    expect(capabilityForHostImplementation({ source: forwarded, detail: 'test' }).capability).toBe('supported')
  })
  it('stays unknown when the implementation cannot be read', () => {
    const verdict = capabilityForHostImplementation({ detail: 'cannot resolve @deepseek-ai/dsh-session' })
    expect(verdict.capability).toBe('unknown')
    expect(verdict.detail).toContain('cannot resolve')
  })
})

describe('session record writer', () => {
  it('writes with the marker on a forwarding host', () => {
    const writer = new SessionRecordWriter({ readHostImplementation: readHost(forwarded, '0.1.8'), force: false })
    const append = vi.fn(() => ({ ignorable: true }))
    expect(writer.enabled()).toBe(true)
    expect(writer.append({ append } as unknown as Session, record)).toBe(true)
    expect(append).toHaveBeenCalledWith('token-usage/record', { record }, { ignorable: true })
    expect(writer.status()).toMatchObject({ capability: 'supported', hostVersion: '0.1.8', forced: false })
  })
  it('never writes when the host drops the marker', () => {
    const writer = new SessionRecordWriter({ readHostImplementation: readHost(dropped, '0.1.7-rc.2'), force: false })
    const append = vi.fn()
    expect(writer.status().capability).toBe('unsupported')
    expect(writer.enabled()).toBe(false)
    expect(writer.append({ append } as unknown as Session, record)).toBe(false)
    expect(append).not.toHaveBeenCalled()
  })
  it('never writes while the implementation is unreadable', () => {
    const writer = new SessionRecordWriter({ readHostImplementation: readHost(), force: false })
    const append = vi.fn()
    expect(writer.status().capability).toBe('unknown')
    expect(writer.append({ append } as unknown as Session, record)).toBe(false)
    expect(append).not.toHaveBeenCalled()
  })
  it('stops for good when a forwarding host still drops the marker', () => {
    const onStop = vi.fn()
    const writer = new SessionRecordWriter({ readHostImplementation: readHost(forwarded, '0.1.8'), force: false, onStop })
    const append = vi.fn(() => ({}))
    expect(writer.append({ append } as unknown as Session, record)).toBe(false)
    expect(onStop).toHaveBeenCalledOnce()
    expect(writer.status().capability).toBe('unsupported')
    expect(writer.enabled()).toBe(false)
    expect(writer.append({ append } as unknown as Session, record)).toBe(false)
    expect(append).toHaveBeenCalledTimes(1)
  })
  it('keeps a write failure from stopping later writes', () => {
    const writer = new SessionRecordWriter({ readHostImplementation: readHost(forwarded, '0.1.8'), force: false })
    const append = vi.fn(() => { throw new Error('append rejected') })
    expect(writer.append({ append } as unknown as Session, record)).toBe(false)
    expect(writer.enabled()).toBe(true)
  })
  it('honours the explicit override and the environment flag', () => {
    const append = vi.fn(() => ({ ignorable: true }))
    const forced = new SessionRecordWriter({ readHostImplementation: readHost(dropped, '0.1.7-rc.2'), force: true })
    expect(forced.enabled()).toBe(true)
    expect(forced.append({ append } as unknown as Session, record)).toBe(true)
    process.env[FORCE_SESSION_RECORDS_ENV] = '1'
    try {
      const fromEnv = new SessionRecordWriter({ readHostImplementation: readHost(dropped, '0.1.7-rc.2') })
      expect(fromEnv.status().forced).toBe(true)
      expect(fromEnv.enabled()).toBe(true)
    } finally {
      delete process.env[FORCE_SESSION_RECORDS_ENV]
    }
  })
})
