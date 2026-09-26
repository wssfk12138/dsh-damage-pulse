/** Schema identifier accepted for standing whale animation manifests. */
export const STANDING_WHALE_ANIMATION_SCHEMA = 'standing-whale-animation.v1' as const

const CANVAS_SIZE = 512
const MAX_CLIPS = 64
const MAX_LAYERS = 16
const MAX_FRAMES = 600

/** Two-dimensional point in whale animation coordinates. */
export interface WhaleAnimationPoint {
  x: number
  y: number
}

/** One image layer and its placement within an animation frame. */
export interface WhaleAnimationLayer {
  id: string
  zIndex: number
  anchor: WhaleAnimationPoint
  position: WhaleAnimationPoint
  scale: WhaleAnimationPoint
  alpha: number
}

/** Ordered layers and duration for one animation frame. */
export interface WhaleAnimationFrame {
  durationMs: number
  sources: Readonly<Record<string, string>>
}

/** Frame range and repetition count for a named animation loop. */
export interface WhaleAnimationLoop {
  startFrame: number
  endFrame: number
}

/** Named frame sequence and loop metadata within a whale animation manifest. */
export interface WhaleAnimationClip {
  layers: readonly WhaleAnimationLayer[]
  frames: readonly WhaleAnimationFrame[]
  loop?: WhaleAnimationLoop
  safeInterruptFrames: readonly number[]
  nextClip?: string
}

/**
 * Stable hand-off format between generated standing-whale assets and the PixiJS player.
 * A composite sequence uses one layer; transparent body-part sequences use multiple layers.
 */
export interface StandingWhaleAnimationManifest {
  schema: typeof STANDING_WHALE_ANIMATION_SCHEMA
  canvas: {
    width: typeof CANVAS_SIZE
    height: typeof CANVAS_SIZE
  }
  defaultClip: string
  clips: Readonly<Record<string, WhaleAnimationClip>>
}

/** Validation error raised for an invalid whale animation manifest. */
export class WhaleAnimationManifestError extends Error {
  constructor(path: string, message: string) {
    super(`${path}: ${message}`)
    this.name = 'WhaleAnimationManifestError'
  }
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new WhaleAnimationManifestError(path, 'expected an object')
  }
  return value as Record<string, unknown>
}

function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) throw new WhaleAnimationManifestError(path, 'expected an array')
  return value
}

function finiteNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new WhaleAnimationManifestError(path, 'expected a finite number')
  }
  return value
}

function integer(value: unknown, path: string): number {
  const parsed = finiteNumber(value, path)
  if (!Number.isInteger(parsed)) throw new WhaleAnimationManifestError(path, 'expected an integer')
  return parsed
}

function identifier(value: unknown, path: string): string {
  if (typeof value !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(value)) {
    throw new WhaleAnimationManifestError(path, 'expected a lowercase kebab-case identifier')
  }
  return value
}

function sourcePath(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 240) {
    throw new WhaleAnimationManifestError(path, 'expected a non-empty asset path')
  }
  if (value.startsWith('/') || value.includes('\\') || value.includes('?') || value.includes('#')) {
    throw new WhaleAnimationManifestError(path, 'asset paths must be relative and contain no query or fragment')
  }
  if (value.split('/').some(part => part === '' || part === '.' || part === '..')) {
    throw new WhaleAnimationManifestError(path, 'asset paths must stay inside the animation asset root')
  }
  if (!/^[a-zA-Z0-9_./@+-]+$/.test(value)) {
    throw new WhaleAnimationManifestError(path, 'asset path contains unsupported characters')
  }
  return value
}

function point(
  value: unknown,
  path: string,
  fallback: WhaleAnimationPoint,
  min: number,
  max: number,
): WhaleAnimationPoint {
  if (value === undefined) return fallback
  const input = record(value, path)
  const x = finiteNumber(input.x, `${path}.x`)
  const y = finiteNumber(input.y, `${path}.y`)
  if (x < min || x > max || y < min || y > max) {
    throw new WhaleAnimationManifestError(path, `coordinates must be between ${min} and ${max}`)
  }
  return { x, y }
}

function parseLayer(value: unknown, path: string): WhaleAnimationLayer {
  const input = record(value, path)
  const alpha = input.alpha === undefined ? 1 : finiteNumber(input.alpha, `${path}.alpha`)
  if (alpha < 0 || alpha > 1) throw new WhaleAnimationManifestError(`${path}.alpha`, 'expected a value from 0 to 1')
  return {
    id: identifier(input.id, `${path}.id`),
    zIndex: input.zIndex === undefined ? 0 : integer(input.zIndex, `${path}.zIndex`),
    anchor: point(input.anchor, `${path}.anchor`, { x: 0.5, y: 0.5 }, 0, 1),
    position: point(input.position, `${path}.position`, { x: 256, y: 256 }, -512, 1024),
    scale: point(input.scale, `${path}.scale`, { x: 1, y: 1 }, 0.01, 4),
    alpha,
  }
}

function parseClip(value: unknown, path: string): WhaleAnimationClip {
  const input = record(value, path)
  const layersInput = array(input.layers, `${path}.layers`)
  if (layersInput.length === 0 || layersInput.length > MAX_LAYERS) {
    throw new WhaleAnimationManifestError(`${path}.layers`, `expected 1 to ${MAX_LAYERS} layers`)
  }
  const layers = layersInput.map((layer, index) => parseLayer(layer, `${path}.layers[${index}]`))
  const layerIds = new Set<string>()
  for (const layer of layers) {
    if (layerIds.has(layer.id)) throw new WhaleAnimationManifestError(`${path}.layers`, `duplicate layer id: ${layer.id}`)
    layerIds.add(layer.id)
  }

  const framesInput = array(input.frames, `${path}.frames`)
  if (framesInput.length === 0 || framesInput.length > MAX_FRAMES) {
    throw new WhaleAnimationManifestError(`${path}.frames`, `expected 1 to ${MAX_FRAMES} frames`)
  }
  const frames = framesInput.map((frameValue, frameIndex): WhaleAnimationFrame => {
    const framePath = `${path}.frames[${frameIndex}]`
    const frame = record(frameValue, framePath)
    const durationMs = finiteNumber(frame.durationMs, `${framePath}.durationMs`)
    if (durationMs < 8 || durationMs > 5_000) {
      throw new WhaleAnimationManifestError(`${framePath}.durationMs`, 'expected 8 to 5000 milliseconds')
    }
    const sourceInput = record(frame.sources, `${framePath}.sources`)
    const sourceIds = Object.keys(sourceInput)
    if (sourceIds.length !== layerIds.size || sourceIds.some(id => !layerIds.has(id))) {
      throw new WhaleAnimationManifestError(`${framePath}.sources`, 'must contain exactly one source for every declared layer')
    }
    return {
      durationMs,
      sources: Object.fromEntries(layers.map(layer => [
        layer.id,
        sourcePath(sourceInput[layer.id], `${framePath}.sources.${layer.id}`),
      ])),
    }
  })

  let loop: WhaleAnimationLoop | undefined
  if (input.loop !== undefined) {
    const loopInput = record(input.loop, `${path}.loop`)
    const startFrame = integer(loopInput.startFrame, `${path}.loop.startFrame`)
    const endFrame = integer(loopInput.endFrame, `${path}.loop.endFrame`)
    if (startFrame < 0 || endFrame < startFrame || endFrame >= frames.length) {
      throw new WhaleAnimationManifestError(`${path}.loop`, 'frame range is outside the clip')
    }
    loop = { startFrame, endFrame }
  }

  const interruptInput = input.safeInterruptFrames === undefined
    ? []
    : array(input.safeInterruptFrames, `${path}.safeInterruptFrames`)
  const safeInterruptFrames = [...new Set(interruptInput.map((frame, index) => {
    const parsed = integer(frame, `${path}.safeInterruptFrames[${index}]`)
    if (parsed < 0 || parsed >= frames.length) {
      throw new WhaleAnimationManifestError(`${path}.safeInterruptFrames[${index}]`, 'frame is outside the clip')
    }
    return parsed
  }))].sort((a, b) => a - b)

  return {
    layers,
    frames,
    ...(loop === undefined ? {} : { loop }),
    safeInterruptFrames,
    ...(input.nextClip === undefined ? {} : { nextClip: identifier(input.nextClip, `${path}.nextClip`) }),
  }
}

/**
 * Parse and validate a model-produced animation manifest before any texture is loaded.
 * @param value - Untrusted value to validate or format.
 * @returns A detached, validated standing whale animation manifest.
 */
export function parseStandingWhaleAnimationManifest(value: unknown): StandingWhaleAnimationManifest {
  const input = record(value, '$')
  if (input.schema !== STANDING_WHALE_ANIMATION_SCHEMA) {
    throw new WhaleAnimationManifestError('$.schema', `expected ${STANDING_WHALE_ANIMATION_SCHEMA}`)
  }
  const canvas = record(input.canvas, '$.canvas')
  if (canvas.width !== CANVAS_SIZE || canvas.height !== CANVAS_SIZE) {
    throw new WhaleAnimationManifestError('$.canvas', `expected the existing ${CANVAS_SIZE}x${CANVAS_SIZE} whale stage`)
  }
  const defaultClip = identifier(input.defaultClip, '$.defaultClip')
  const clipInput = record(input.clips, '$.clips')
  const clipNames = Object.keys(clipInput)
  if (clipNames.length === 0 || clipNames.length > MAX_CLIPS) {
    throw new WhaleAnimationManifestError('$.clips', `expected 1 to ${MAX_CLIPS} clips`)
  }
  const clips = Object.fromEntries(clipNames.map((name) => {
    const clipName = identifier(name, `$.clips.${name}`)
    return [clipName, parseClip(clipInput[name], `$.clips.${clipName}`)]
  }))
  if (!(defaultClip in clips)) throw new WhaleAnimationManifestError('$.defaultClip', 'must name an existing clip')
  for (const [name, clip] of Object.entries(clips)) {
    if (clip.nextClip !== undefined && !(clip.nextClip in clips)) {
      throw new WhaleAnimationManifestError(`$.clips.${name}.nextClip`, 'must name an existing clip')
    }
  }
  return {
    schema: STANDING_WHALE_ANIMATION_SCHEMA,
    canvas: { width: CANVAS_SIZE, height: CANVAS_SIZE },
    defaultClip,
    clips,
  }
}

/**
 * Resolve a validated relative frame path against the plugin-owned asset directory.
 * @param assetRoot - Base URL containing animation assets.
 * @param source - Manifest-relative asset path.
 * @returns The resolved asset URL, preserving absolute and data URLs.
 */
export function resolveWhaleAnimationAssetUrl(assetRoot: string, source: string): string {
  const validatedSource = sourcePath(source, 'source')
  if (assetRoot.length === 0) throw new WhaleAnimationManifestError('assetRoot', 'expected a non-empty asset root')
  return `${assetRoot.replace(/\/$/, '')}/${validatedSource}`
}
