// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { tokenMonitorUrl } from '../src/client/monitorUrl.ts'
import { createTokenMonitorSettingsApi } from '../src/client/settingsApi.ts'
import { createBillingEvents } from '../src/client/billingEvents.ts'

afterEach(() => {
  document.head.querySelectorAll('base').forEach(node => node.remove())
  vi.unstubAllGlobals()
})

describe('Token Monitor app-route resolution', () => {
  it('keeps the documented site-root route shape', () => {
    expect(tokenMonitorUrl('/api/token-monitor/balance?provider=a', 'https://dsh.example/'))
      .toBe('/api/token-monitor/balance?provider=a')
  })

  it('prefixes a reverse-proxy mount without changing query or fragment', () => {
    expect(tokenMonitorUrl('/api/token-monitor/balance?provider=a#card', 'https://dsh.example/app/Harness/dsh/'))
      .toBe('/app/Harness/dsh/api/token-monitor/balance?provider=a#card')
    expect(tokenMonitorUrl('/token-monitor-assets/whale-girl/idle-08.png', 'https://dsh.example/app/Harness/dsh/'))
      .toBe('/app/Harness/dsh/token-monitor-assets/whale-girl/idle-08.png')
  })

  it('shows the root-absolute bypass the mounted resolver replaces', () => {
    const mounted = 'https://dsh.example/app/Harness/dsh/'
    expect(new URL('/api/token-monitor/balance', mounted).pathname).toBe('/api/token-monitor/balance')
    expect(tokenMonitorUrl('/api/token-monitor/balance', mounted)).toBe('/app/Harness/dsh/api/token-monitor/balance')
  })

  it('keeps an index.html document base in its containing directory', () => {
    expect(tokenMonitorUrl('/api/token-monitor/settings', 'https://dsh.example/app/Harness/dsh/index.html'))
      .toBe('/app/Harness/dsh/api/token-monitor/settings')
  })

  it('uses an absolute URL for the desktop custom scheme', () => {
    expect(tokenMonitorUrl('/api/token-monitor/modules', 'dsh-app://app/'))
      .toBe('dsh-app://app/api/token-monitor/modules')
  })

  it('passes absolute and protocol-relative values through', () => {
    expect(tokenMonitorUrl('https://cdn.example/asset.png', 'https://dsh.example/app/'))
      .toBe('https://cdn.example/asset.png')
    expect(tokenMonitorUrl('//cdn.example/asset.png', 'https://dsh.example/app/'))
      .toBe('//cdn.example/asset.png')
  })

  it('leaves a route untouched when no usable document base exists', () => {
    expect(tokenMonitorUrl('/api/token-monitor/settings', 'not a URL'))
      .toBe('/api/token-monitor/settings')
  })

  it('reads the mounted document base by default', () => {
    document.head.insertAdjacentHTML('beforeend', '<base href="/app/Harness/dsh/">')
    expect(tokenMonitorUrl('/api/token-monitor/settings')).toBe('/app/Harness/dsh/api/token-monitor/settings')
  })

  it('binds default API clients to the mounted document base', async () => {
    document.head.insertAdjacentHTML('beforeend', '<base href="/app/Harness/dsh/">')
    const calls: string[] = []
    const api = createTokenMonitorSettingsApi(async (input) => {
      calls.push(String(input))
      throw new Error('stop after recording the route')
    })
    await expect(api.get()).rejects.toThrow('stop after recording the route')
    expect(calls).toEqual(['/app/Harness/dsh/api/token-monitor/settings'])
  })

  it('binds the billing event stream to the mounted document base', () => {
    document.head.insertAdjacentHTML('beforeend', '<base href="/app/Harness/dsh/">')
    const urls: string[] = []
    vi.stubGlobal('EventSource', class {
      constructor(url: string) { urls.push(url) }
      close() {}
    })
    const events = createBillingEvents()
    const unsubscribe = events.subscribe(() => {})
    expect(urls).toEqual(['/app/Harness/dsh/api/token-monitor/billing/events'])
    unsubscribe()
    events.dispose()
  })
})
