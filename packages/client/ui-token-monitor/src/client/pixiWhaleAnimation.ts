import type { AnimatedSprite, Container, Texture } from 'pixi.js'
import {
  resolveWhaleAnimationAssetUrl,
  type StandingWhaleAnimationManifest,
  type WhaleAnimationFrame,
} from './whaleAnimationManifest.ts'

interface PixiFrame {
  texture: Texture
  time: number
}

/** PIXI constructors used to render one whale animation clip. */
export interface WhalePixiRuntime {
  createContainer(): Container
  createAnimatedSprite(frames: PixiFrame[]): AnimatedSprite
  loadTexture(url: string): Promise<Texture>
  unloadTexture(url: string): Promise<void>
}

/** Mutable playback state exposed by a loaded whale animation clip. */
export interface PixiWhaleClipState {
  frame: number
  complete: boolean
  canInterrupt: boolean
}

/** Loaded whale animation clip and its lifecycle controls. */
export interface PixiWhaleClip {
  readonly container: Container
  readonly clipName: string
  readonly durationMs: number
  readonly state: PixiWhaleClipState
  advance(deltaMs: number): PixiWhaleClipState
  reset(): PixiWhaleClipState
  dispose(): Promise<void>
}

/** Inputs required to load a whale animation clip into a PIXI container. */
export interface LoadPixiWhaleClipOptions {
  manifest: StandingWhaleAnimationManifest
  clipName: string
  assetRoot: string
  runtime?: WhalePixiRuntime
  onComplete?: () => void
}

async function defaultPixiRuntime(): Promise<WhalePixiRuntime> {
  const { AnimatedSprite, Assets, Container } = await import('pixi.js')
  return {
    createContainer: () => new Container(),
    createAnimatedSprite: frames => new AnimatedSprite({
      textures: frames,
      autoPlay: false,
      autoUpdate: false,
      loop: false,
    }),
    loadTexture: url => Assets.load<Texture>(url),
    unloadTexture: url => Assets.unload(url),
  }
}

function frameAtElapsed(
  elapsedMs: number,
  offsets: readonly number[],
  loop: { startFrame: number; endFrame: number } | undefined,
): { frame: number; complete: boolean } {
  const total = offsets.at(-1) ?? 0
  const frameCount = offsets.length - 1
  const offsetAt = (index: number) => offsets[index] ?? total
  let position = Math.max(0, elapsedMs)
  let complete = false
  if (loop !== undefined) {
    const loopStart = offsetAt(loop.startFrame)
    const loopEnd = offsetAt(loop.endFrame + 1)
    if (position >= loopEnd) position = loopStart + ((position - loopStart) % (loopEnd - loopStart))
  } else if (position >= total) {
    position = Math.max(0, total - Number.EPSILON)
    complete = true
  }
  const frame = Math.min(frameCount - 1, offsets.findIndex((_, index) => (
    index < frameCount && position < offsetAt(index + 1)
  )))
  return { frame: frame < 0 ? frameCount - 1 : frame, complete }
}

function frameLayerSource(frame: WhaleAnimationFrame, layerId: string): string {
  const source = frame.sources[layerId]
  if (source === undefined) throw new Error(`Standing whale frame has no source for layer: ${layerId}`)
  return source
}

async function releaseTextures(runtime: WhalePixiRuntime, urls: readonly string[]): Promise<void> {
  await Promise.allSettled(urls.map(url => runtime.unloadTexture(url)))
}

/**
 * Load one validated generated clip into synchronized PixiJS AnimatedSprites.
 * The caller advances time so the existing whale state machine remains the sole clock owner.
 * @param options - Runtime, manifest, asset root, and target container for the clip.
 * @returns The loaded clip and controls after its initial frame is rendered.
 */
export async function loadPixiWhaleClip(options: LoadPixiWhaleClipOptions): Promise<PixiWhaleClip> {
  const clip = options.manifest.clips[options.clipName]
  if (clip === undefined) throw new Error(`Unknown standing whale clip: ${options.clipName}`)
  const runtime = options.runtime ?? await defaultPixiRuntime()
  const urls = [...new Set(clip.frames.flatMap(frame => clip.layers.map(layer => (
    resolveWhaleAnimationAssetUrl(options.assetRoot, frameLayerSource(frame, layer.id))
  ))))]
  const loaded = await Promise.allSettled(urls.map(async url => ({
    url,
    texture: await runtime.loadTexture(url),
  })))
  const failed = loaded.find(result => result.status === 'rejected')
  const fulfilled = loaded
    .filter((result): result is PromiseFulfilledResult<{ url: string; texture: Texture }> => result.status === 'fulfilled')
    .map(result => result.value)
  if (failed !== undefined) {
    await releaseTextures(runtime, fulfilled.map(asset => asset.url))
    throw new Error(`Failed to load PixiJS textures for standing whale clip: ${options.clipName}`, { cause: failed.reason })
  }

  const textures = new Map(fulfilled.map(asset => [asset.url, asset.texture]))
  const container = runtime.createContainer()
  const sprites: AnimatedSprite[] = []
  try {
    for (const layer of [...clip.layers].sort((left, right) => left.zIndex - right.zIndex)) {
      const frames = clip.frames.map((frame) => {
        const source = resolveWhaleAnimationAssetUrl(options.assetRoot, frameLayerSource(frame, layer.id))
        const texture = textures.get(source)
        if (texture === undefined) throw new Error(`Standing whale texture is unavailable: ${source}`)
        return { texture, time: frame.durationMs }
      })
      const sprite = runtime.createAnimatedSprite(frames)
      sprite.anchor.set(layer.anchor.x, layer.anchor.y)
      sprite.position.set(layer.position.x, layer.position.y)
      sprite.scale.set(layer.scale.x, layer.scale.y)
      sprite.alpha = layer.alpha
      sprite.zIndex = layer.zIndex
      sprite.gotoAndStop(0)
      sprites.push(sprite)
      container.addChild(sprite)
    }
  } catch (error) {
    for (const sprite of sprites) sprite.destroy()
    container.destroy()
    await releaseTextures(runtime, urls)
    throw error
  }

  const durations = clip.frames.map(frame => frame.durationMs)
  const offsets = durations.reduce<number[]>((result, duration) => {
    result.push((result.at(-1) ?? 0) + duration)
    return result
  }, [0])
  const durationMs = durations.reduce((total, duration) => total + duration, 0)
  const safeFrames = new Set(clip.safeInterruptFrames)
  let elapsedMs = 0
  let disposed = false
  let completionReported = false
  let state: PixiWhaleClipState = {
    frame: 0,
    complete: false,
    canInterrupt: safeFrames.has(0),
  }

  const render = (): PixiWhaleClipState => {
    const next = frameAtElapsed(elapsedMs, offsets, clip.loop)
    if (next.frame !== state.frame) {
      for (const sprite of sprites) sprite.gotoAndStop(next.frame)
    }
    state = {
      frame: next.frame,
      complete: next.complete,
      canInterrupt: safeFrames.has(next.frame),
    }
    if (state.complete && !completionReported) {
      completionReported = true
      options.onComplete?.()
    }
    return state
  }

  return {
    container,
    clipName: options.clipName,
    durationMs,
    get state() { return state },
    advance(deltaMs) {
      if (disposed) throw new Error(`Standing whale clip has been disposed: ${options.clipName}`)
      if (!Number.isFinite(deltaMs) || deltaMs < 0) throw new Error('Animation delta must be a finite non-negative number')
      elapsedMs += deltaMs
      return render()
    },
    reset() {
      if (disposed) throw new Error(`Standing whale clip has been disposed: ${options.clipName}`)
      elapsedMs = 0
      completionReported = false
      for (const sprite of sprites) sprite.gotoAndStop(0)
      state = { frame: 0, complete: false, canInterrupt: safeFrames.has(0) }
      return state
    },
    async dispose() {
      if (disposed) return
      disposed = true
      for (const sprite of sprites) sprite.destroy()
      container.destroy()
      await releaseTextures(runtime, urls)
    },
  }
}
