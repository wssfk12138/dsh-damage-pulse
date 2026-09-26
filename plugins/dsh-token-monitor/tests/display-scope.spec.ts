import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { attachDisplayScope } from '../src/display-scope.ts'

describe('foreground execution routing', () => {
  it('keeps concurrent sessions separate, retains tool waits and releases completed routes', async () => {
    const ctx = new Context()
    const routes = attachDisplayScope(ctx)
    const agent = (id: string, provider: string) => ({ session: { id, requestHeader: () => ({ config: { provider, model: 'same-name' } }) } })
    const a = agent('a', 'provider-a'), b = agent('b', 'provider-b')
    await ctx.emit('agent/assistant-stream', { agent: a, frame: { type: 'start' } } as never)
    await ctx.emit('agent/assistant-stream', { agent: b, frame: { type: 'start' } } as never)
    await ctx.emit('agent/assistant-stream', { agent: a, frame: { type: 'end' } } as never)
    expect(routes.get('a')?.provider).toBe('provider-a')
    expect(routes.get('b')?.provider).toBe('provider-b')
    await ctx.emit('agent/status', { agent: a, status: 'idle' } as never)
    expect(routes.has('a')).toBe(false)
    expect(routes.has('b')).toBe(true)
    await ctx.fiber.dispose()
    expect(routes.size).toBe(0)
  })
})
