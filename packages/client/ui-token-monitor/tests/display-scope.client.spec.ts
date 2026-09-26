// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import { createDisplayScopeLoader } from '../src/client/displayScope.ts'
import { useDisplayScope } from '../src/client/useDisplayScope.ts'

describe('foreground display scope', () => {
  afterEach(() => vi.useRealTimers())
  it('uses execution A, then selector B after idle, with no pricing gate', async () => {
    const directories = { directoryFor: () => ({ load: async () => ({ current: { provider: 'B', model: 'unpriced' }, routable: true }) }) }
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ provider: 'A', model: 'running' }))).mockResolvedValueOnce(new Response('null'))
    const load = createDisplayScopeLoader(directories, async () => ({}), fetcher)
    const signal = new AbortController().signal
    expect(await load(SessionId('main'), signal)).toEqual({ sessionId: 'main', provider: 'A', model: 'running' })
    expect(await load(SessionId('main'), signal)).toEqual({ sessionId: 'main', provider: 'B', model: 'unpriced' })
  })
  it('uses the catalog default on startup and refuses failed execution lookups', async () => {
    const directories = { directoryFor: vi.fn() }
    const fetcher = vi.fn().mockResolvedValue(new Response('', { status: 503 }))
    const load = createDisplayScopeLoader(directories, async () => ({ default: { provider: 'B', model: 'new' } }), fetcher)
    expect(await load(undefined, new AbortController().signal)).toEqual({ provider: 'B', model: 'new' })
    await expect(load(SessionId('main'), new AbortController().signal)).rejects.toThrow('Execution route unavailable')
    expect(directories.directoryFor).not.toHaveBeenCalled()
  })
  it('never lets a delayed background response replace a new foreground', async () => {
    vi.useFakeTimers()
    let selected = 'A'
    let settle!: (value: { provider: string; model: string; sessionId: string }) => void
    const load = vi.fn().mockImplementationOnce(() => new Promise((resolve) => { settle = resolve })).mockResolvedValue({ sessionId: 'B', provider: 'B', model: 'new' })
    const useSessions = (select: (snapshot: unknown) => unknown) => select({ byId: { [selected]: { id: selected, retainedBy: { mainView: 1 } }, background: { id: 'background', retainedBy: {} } } })
    const hook = renderHook(() => useDisplayScope(useSessions as never, load))
    selected = 'B'
    hook.rerender()
    expect(hook.result.current).toBeUndefined()
    await act(async () => {})
    expect(hook.result.current?.provider).toBe('B')
    await act(async () => { settle({ sessionId: 'A', provider: 'A', model: 'old' }) })
    expect(hook.result.current?.provider).toBe('B')
    expect(load.mock.calls[0]?.[1].aborted).toBe(true)
    hook.unmount()
  })
})
