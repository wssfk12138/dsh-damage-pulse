import { describe, expect, it, vi } from 'vitest'
import type { WhalePixiRuntime } from '../src/client/pixiWhaleAnimation.ts'
import { loadPixiWhaleClip } from '../src/client/pixiWhaleAnimation.ts'
import {
  parseStandingWhaleAnimationManifest,
  resolveWhaleAnimationAssetUrl,
  WhaleAnimationManifestError,
} from '../src/client/whaleAnimationManifest.ts'

type SpecFrame = { durationMs: number; sources: Record<string, string> }
type SpecManifest = {
  clips: {
    idle: {
      frames: SpecFrame[]
      loop?: { startFrame: number; endFrame: number }
      safeInterruptFrames: number[]
    }
  }
}

function modelManifest(): Record<string, unknown> {
  return {
    schema: 'standing-whale-animation.v1',
    canvas: { width: 512, height: 512 },
    defaultClip: 'idle',
    clips: {
      idle: {
        layers: [
          { id: 'hair', zIndex: 10, anchor: { x: 0.5, y: 1 }, position: { x: 256, y: 470 } },
          { id: 'body', zIndex: 0, anchor: { x: 0.5, y: 1 }, position: { x: 256, y: 470 } },
        ],
        frames: [
          { durationMs: 100, sources: { hair: 'idle/hair.webp', body: 'idle/body-001.webp' } },
          { durationMs: 200, sources: { hair: 'idle/hair.webp', body: 'idle/body-002.webp' } },
          { durationMs: 300, sources: { hair: 'idle/hair.webp', body: 'idle/body-003.webp' } },
        ],
        loop: { startFrame: 1, endFrame: 2 },
        safeInterruptFrames: [2, 0, 2],
        nextClip: 'idle',
      },
    },
  }
}

function fakeRuntime(failingUrl?: string) {
  const loaded: string[] = []
  const unloaded: string[] = []
  const sprites: Array<{
    frames: Array<{ texture: unknown; time: number }>
    gotoAndStop: ReturnType<typeof vi.fn>
    destroy: ReturnType<typeof vi.fn>
    zIndex: number
  }> = []
  const children: unknown[] = []
  const container = {
    addChild: vi.fn((child: unknown) => children.push(child)),
    destroy: vi.fn(),
  }
  const runtime: WhalePixiRuntime = {
    createContainer: () => container as never,
    createAnimatedSprite: (frames) => {
      const sprite = {
        frames,
        anchor: { set: vi.fn() },
        position: { set: vi.fn() },
        scale: { set: vi.fn() },
        alpha: 1,
        zIndex: 0,
        gotoAndStop: vi.fn(),
        destroy: vi.fn(),
      }
      sprites.push(sprite)
      return sprite as never
    },
    async loadTexture(url) {
      loaded.push(url)
      if (url === failingUrl) throw new Error('fixture load failure')
      return { url } as never
    },
    async unloadTexture(url) {
      unloaded.push(url)
    },
  }
  return { runtime, loaded, unloaded, sprites, children, container }
}

describe('standing whale animation manifest', () => {
  it('normalizes a model manifest for composite or synchronized layered sequences', () => {
    const manifest = parseStandingWhaleAnimationManifest(modelManifest())
    const idle = manifest.clips.idle
    if (idle === undefined) throw new Error('missing idle clip')

    expect(manifest.canvas).toEqual({ width: 512, height: 512 })
    expect(idle.layers[0]).toMatchObject({
      id: 'hair',
      anchor: { x: 0.5, y: 1 },
      scale: { x: 1, y: 1 },
      alpha: 1,
    })
    expect(idle.frames.map(frame => frame.durationMs)).toEqual([100, 200, 300])
    expect(idle.safeInterruptFrames).toEqual([0, 2])
  })

  it.each([
    ['an empty frame list', (value: SpecManifest) => { value.clips.idle.frames = [] }, '$.clips.idle.frames'],
    ['an invalid duration', (value: SpecManifest) => { value.clips.idle.frames[0]!.durationMs = 0 }, 'durationMs'],
    ['an out-of-range loop', (value: SpecManifest) => { value.clips.idle.loop!.endFrame = 3 }, '$.clips.idle.loop'],
    ['an out-of-range interrupt', (value: SpecManifest) => { value.clips.idle.safeInterruptFrames = [3] }, 'safeInterruptFrames'],
    ['a missing layer source', (value: SpecManifest) => { delete value.clips.idle.frames[0]!.sources.hair }, '.sources'],
    ['a path traversal source', (value: SpecManifest) => { value.clips.idle.frames[0]!.sources.hair = '../hair.webp' }, 'asset root'],
  ])('rejects %s before PixiJS receives it', (_, mutate, message) => {
    const value = modelManifest() as unknown as SpecManifest
    mutate(value)
    expect(() => parseStandingWhaleAnimationManifest(value)).toThrowError(message)
  })

  it('resolves generated files only under the supplied plugin asset root', () => {
    expect(resolveWhaleAnimationAssetUrl('/assets/dsh-token-monitor/standing-v1/', 'idle/frame-001.webp'))
      .toBe('/assets/dsh-token-monitor/standing-v1/idle/frame-001.webp')
    expect(() => resolveWhaleAnimationAssetUrl('/assets/whale', 'https://example.com/frame.webp'))
      .toThrow(WhaleAnimationManifestError)
  })
})

describe('PixiJS standing whale clip adapter', () => {
  it('loads unique textures, preserves frame timing, orders layers, and follows the loop range', async () => {
    const manifest = parseStandingWhaleAnimationManifest(modelManifest())
    const fake = fakeRuntime()
    const clip = await loadPixiWhaleClip({
      manifest,
      clipName: 'idle',
      assetRoot: '/assets/standing-v1',
      runtime: fake.runtime,
    })

    expect(fake.loaded).toHaveLength(4)
    expect(fake.children.map(child => (child as { zIndex: number }).zIndex)).toEqual([0, 10])
    expect(fake.sprites[0]?.frames.map(frame => frame.time)).toEqual([100, 200, 300])
    expect(clip.durationMs).toBe(600)
    expect(clip.state).toEqual({ frame: 0, complete: false, canInterrupt: true })

    expect(clip.advance(100)).toEqual({ frame: 1, complete: false, canInterrupt: false })
    expect(clip.advance(200)).toEqual({ frame: 2, complete: false, canInterrupt: true })
    expect(clip.advance(300)).toEqual({ frame: 1, complete: false, canInterrupt: false })
    expect(fake.sprites.every(sprite => sprite.gotoAndStop.mock.calls.some(call => call[0] === 2))).toBe(true)

    await clip.dispose()
    expect(fake.unloaded).toHaveLength(4)
    expect(fake.sprites.every(sprite => sprite.destroy.mock.calls.length === 1)).toBe(true)
    expect(fake.container.destroy).toHaveBeenCalledOnce()
  })

  it('reports one-shot completion once and supports reset', async () => {
    const input = modelManifest() as unknown as SpecManifest
    delete input.clips.idle.loop
    const manifest = parseStandingWhaleAnimationManifest(input)
    const fake = fakeRuntime()
    const onComplete = vi.fn()
    const clip = await loadPixiWhaleClip({
      manifest,
      clipName: 'idle',
      assetRoot: '/assets/standing-v1',
      runtime: fake.runtime,
      onComplete,
    })

    expect(clip.advance(600)).toEqual({ frame: 2, complete: true, canInterrupt: true })
    clip.advance(100)
    expect(onComplete).toHaveBeenCalledOnce()
    expect(clip.reset()).toEqual({ frame: 0, complete: false, canInterrupt: true })
    clip.advance(600)
    expect(onComplete).toHaveBeenCalledTimes(2)
    await clip.dispose()
  })

  it('releases every successfully loaded texture when another texture fails', async () => {
    const manifest = parseStandingWhaleAnimationManifest(modelManifest())
    const failedUrl = '/assets/standing-v1/idle/body-002.webp'
    const fake = fakeRuntime(failedUrl)

    await expect(loadPixiWhaleClip({
      manifest,
      clipName: 'idle',
      assetRoot: '/assets/standing-v1',
      runtime: fake.runtime,
    })).rejects.toThrow('Failed to load PixiJS textures')

    expect(fake.unloaded.sort()).toEqual(fake.loaded.filter(url => url !== failedUrl).sort())
  })
})
