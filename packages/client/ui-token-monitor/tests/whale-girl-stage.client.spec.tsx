// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WhaleGirlStage, type WhalePose } from '../src/client/WhaleGirlStage.tsx'

type Draw = { source: unknown; operation: string; alpha: number; args: number[] }

/** Observe the real stage; only browser image/canvas/clock primitives are replaced. */
function stageBrowser(options: { holdBase?: boolean; holdRevive?: boolean } = {}) {
  const pending = new Map<number, FrameRequestCallback>()
  const contexts = new Map<HTMLCanvasElement, ReturnType<typeof context>>()
  const requested: string[] = []
  const releases: (() => void)[] = []
  let nextId = 0
  function context() {
    const draws: Draw[] = []
    const events: string[] = []
    const stack: { operation: string; alpha: number }[] = []
    return {
      draws, events, globalCompositeOperation: 'source-over', globalAlpha: 1,
      save() { events.push('save'); stack.push({ operation: this.globalCompositeOperation, alpha: this.globalAlpha }) },
      restore() { events.push('restore'); const value = stack.pop()!; this.globalCompositeOperation = value.operation; this.globalAlpha = value.alpha },
      clearRect: vi.fn(() => events.push('clear')),
      drawImage(source: unknown, ...args: number[]) { events.push('draw'); draws.push({ source, args, operation: this.globalCompositeOperation, alpha: this.globalAlpha }) },
      translate: vi.fn(), rotate: vi.fn(), scale: vi.fn(), beginPath: vi.fn(),
      moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(), fillText: vi.fn(),
    }
  }
  class TestImage {
    onload: (() => void) | null = null
    onerror: (() => void) | null = null
    url = ''
    decode = async () => {}
    set src(url: string) {
      this.url = url
      requested.push(url)
      const load = () => this.onload?.()
      if ((options.holdBase && url.endsWith('/idle-08.png')) || (options.holdRevive && url.endsWith('/revive-reopen.png') && url.includes('/revive-recharge-v1/'))) releases.push(load)
      else queueMicrotask(load)
    }
  }
  vi.stubGlobal('Image', TestImage)
  vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => { pending.set(++nextId, callback); return nextId }))
  vi.stubGlobal('cancelAnimationFrame', vi.fn((id: number) => { pending.delete(id) }))
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })))
  vi.spyOn(performance, 'now').mockReturnValue(0)
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
    if (!contexts.has(this)) contexts.set(this, context())
    return contexts.get(this)! as CanvasRenderingContext2D
  })
  async function settle() { await act(async () => { for (let i = 0; i < 30; i += 1) await Promise.resolve() }) }
  function frame(now: number) {
    expect(pending.size).toBe(1)
    const [id, callback] = [...pending][0]!
    pending.delete(id)
    act(() => { callback(now) })
  }
  function latestBody() {
    const buffer = [...contexts.keys()].find(canvas => !canvas.isConnected)!
    const source = contexts.get(buffer)!.draws.at(-1)!.source
    if (!(source instanceof TestImage)) throw new Error('Expected one full-body image')
    return source.url
  }
  return {
    pending, contexts, requested, settle, frame, latestBody,
    async release() { releases.splice(0).forEach((load) => { load() }); await settle() },
  }
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('WhaleGirlStage complete-frame and lifecycle contract', () => {
  it('uses one visible canvas and commits one cleared offscreen full-body frame with copy, for every pose', async () => {
    const browser = stageBrowser()
    const view = render(<WhaleGirlStage pose="idle" />)
    await browser.settle()
    const visible = view.container.querySelector('canvas')!
    expect(view.container.querySelectorAll('canvas')).toHaveLength(1)
    expect(visible.width).toBe(512)
    expect(visible.height).toBe(512)
    const buffer = [...browser.contexts.keys()].find(canvas => canvas !== visible)!
    expect(buffer.isConnected).toBe(false)
    expect([buffer.width, buffer.height]).toEqual([512, 512])
    const screen = browser.contexts.get(visible)!
    const offscreen = browser.contexts.get(buffer)!
    const poses: WhalePose[] = ['idle', 'weak-pain', 'normal-pain', 'critical-pain', 'critical-combo', 'heal-happy', 'revive-recharge']
    let now = 0
    for (const pose of poses) {
      view.rerender(<WhaleGirlStage pose={pose} />)
      for (const offset of [0, 100, 500, 1100]) {
        const before = offscreen.draws.length
        const eventStart = offscreen.events.length
        browser.frame(now + offset)
        expect(offscreen.draws.length - before).toBe(1)
        expect(offscreen.draws.at(-1)!.args.slice(-2)).toEqual([512, 512])
        expect(offscreen.draws.at(-1)!.alpha).toBe(1)
        expect(screen.draws.at(-1)).toEqual({ source: buffer, args: [0, 0], operation: 'copy', alpha: 1 })
        expect(offscreen.events[eventStart]).toBe('clear')
        expect(browser.pending.size).toBe(1)
      }
      now += 2000
    }
    expect(screen.draws).toHaveLength(poses.length * 4)
    expect(screen.clearRect).not.toHaveBeenCalled()
    expect(offscreen.clearRect).toHaveBeenCalledTimes(poses.length * 4)
  })

  it('does not allocate a new buffer or restart the face timeline when pain strength or impact changes', async () => {
    const browser = stageBrowser()
    const view = render(<WhaleGirlStage pose="weak-pain" />)
    await browser.settle()
    browser.frame(200)
    expect(browser.latestBody()).toContain('/weak-close.png')
    const requests = browser.requested.length
    view.rerender(<WhaleGirlStage pose="normal-pain" impactPulse={1} />)
    browser.frame(300)
    expect(browser.latestBody()).toContain('/normal-close.png')
    view.rerender(<WhaleGirlStage pose="critical-combo" impactPulse={2} />)
    browser.frame(510)
    expect(browser.latestBody()).toContain('/critical-peak.png')
    expect(browser.contexts.size).toBe(2)
    expect(browser.requested).toHaveLength(requests)
    expect(browser.pending.size).toBe(1)
  })

  it('holds a nonempty death frame until all revive images decode, then starts the full timeline and calls the latest callback once', async () => {
    const browser = stageBrowser({ holdRevive: true })
    const oldComplete = vi.fn()
    const complete = vi.fn()
    const view = render(<WhaleGirlStage pose="revive-recharge" onPoseComplete={oldComplete} />)
    await browser.settle()
    for (const now of [0, 5000, 9000]) { browser.frame(now); expect(browser.latestBody()).toContain('/revive-death-start.png') }
    expect(oldComplete).not.toHaveBeenCalled()
    await browser.release()
    view.rerender(<WhaleGirlStage pose="revive-recharge" onPoseComplete={complete} />)
    const start = 10000
    const phases = [[0, 'death-start'], [220, 'wake'], [720, 'lift'], [1250, 'relief'], [1900, 'hop'], [2400, 'settle'], [2850, 'reopen']] as const
    for (const [elapsed, phase] of phases) { browser.frame(start + elapsed); expect(browser.latestBody()).toContain('/revive-' + phase + '.png') }
    expect(complete).not.toHaveBeenCalled()
    browser.frame(start + 3350)
    await browser.settle()
    browser.frame(start + 4000)
    await browser.settle()
    expect(complete).toHaveBeenCalledExactlyOnceWith('revive-recharge')
    expect(oldComplete).not.toHaveBeenCalled()
  })

  it('does not start RAF or further image loads when base loading finishes after unmount', async () => {
    const browser = stageBrowser({ holdBase: true })
    const view = render(<WhaleGirlStage pose="idle" />)
    expect(browser.pending.size).toBe(0)
    view.unmount()
    await browser.release()
    expect(browser.pending.size).toBe(0)
    expect(browser.requested).toHaveLength(1)
    for (const context of browser.contexts.values()) expect(context.draws).toHaveLength(0)
  })

  it('cancels the last RAF and ignores a late revive group after unmount', async () => {
    const browser = stageBrowser({ holdRevive: true })
    const complete = vi.fn()
    const view = render(<WhaleGirlStage pose="revive-recharge" onPoseComplete={complete} />)
    await browser.settle()
    browser.frame(9000)
    const requests = browser.requested.length
    const drawCounts = [...browser.contexts.values()].map(context => context.draws.length)
    view.unmount()
    expect(browser.pending.size).toBe(0)
    await browser.release()
    expect(browser.pending.size).toBe(0)
    expect(browser.requested).toHaveLength(requests)
    expect([...browser.contexts.values()].map(context => context.draws.length)).toEqual(drawCounts)
    expect(complete).not.toHaveBeenCalled()
  })

  it('leaves no frame callbacks across three normal mount/unmount cycles', async () => {
    const browser = stageBrowser()
    for (let cycle = 0; cycle < 3; cycle += 1) {
      const view = render(<WhaleGirlStage pose="idle" />)
      await browser.settle()
      browser.frame(cycle * 100)
      view.unmount()
      expect(browser.pending.size).toBe(0)
    }
    expect(cancelAnimationFrame).toHaveBeenCalledTimes(3)
  })

  it('does not dispatch a queued pose completion after unmount', async () => {
    const browser = stageBrowser()
    const complete = vi.fn()
    const view = render(<WhaleGirlStage pose="revive-recharge" onPoseComplete={complete} />)
    await browser.settle()
    browser.frame(0)
    const queued: VoidFunction[] = []
    vi.stubGlobal('queueMicrotask', (callback: VoidFunction) => { queued.push(callback) })
    browser.frame(3350)
    expect(queued).toHaveLength(1)
    view.unmount()
    queued.forEach((callback) => { callback() })
    expect(complete).not.toHaveBeenCalled()
    expect(browser.pending.size).toBe(0)
  })
})
