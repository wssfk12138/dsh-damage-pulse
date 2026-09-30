import { useEffect, useRef } from 'react'
import { TOKEN_MONITOR_WHALE_ASSET_BASE } from '@deepseek-ai/dsh-token-monitor-contract'

export type WhalePose = 'idle' | 'weak-pain' | 'normal-pain' | 'critical-pain' | 'critical-combo' | 'heal-happy' | 'revive-recharge'

interface WhaleGirlStageProps {
  pose: WhalePose
  /** 每一条新扣费递增；只追加瞬时冲击，不重置整段受击表情。 */
  impactPulse?: number
  /** 由 Canvas 自己的时间轴报告结束，外层不猜测固定时长。 */
  onPoseComplete?: (pose: WhalePose) => void
  /** 发布展示模式共用的绝对时间轴；让双实例在同一帧呈现同一动作。 */
  syncEpoch?: number
}

const ASSET_ROOT = TOKEN_MONITOR_WHALE_ASSET_BASE
const IDLE_ROOT = `${ASSET_ROOT}/idle-v4-r2`
const FEEDBACK_EXPRESSION_ROOT = `${ASSET_ROOT}/feedback-expression-v4-r4-model/frames`
const CRITICAL_EXPRESSION_ROOT = `${ASSET_ROOT}/feedback-expression-v4-r5-critical-model/frames`
const BASE_IDLE_ASSET = `${IDLE_ROOT}/idle-08.png`
const REVIVE_ROOT = `${ASSET_ROOT}/revive-recharge-v1/frames`
const SIZE = 512

const IDLE_ASSETS = {
  ...Object.fromEntries(Array.from({ length: 8 }, (_, index) => {
    const name = `idle-${String(index + 1).padStart(2, '0')}`
    return [name, `${IDLE_ROOT}/${name}.png`]
  })),
  ...Object.fromEntries(Array.from({ length: 8 }, (_, index) => {
    const name = `acting-${String(index + 1).padStart(2, '0')}`
    return [name, `${IDLE_ROOT}/${name}.png`]
  })),
  'blink-half-close': `${IDLE_ROOT}/blink-half-close.png`,
  'blink-soft': `${IDLE_ROOT}/blink-soft.png`,
  'blink-reopen': `${IDLE_ROOT}/blink-reopen.png`,
} as const

const FEEDBACK_EXPRESSION_ASSETS = Object.fromEntries(
  ['weak', 'normal', 'critical'].flatMap(level =>
    ['half', 'close', 'reopen'].map(phase => {
      const name = `${level}-${phase}`
      return [name, `${FEEDBACK_EXPRESSION_ROOT}/${name}.png`]
    }),
  ),
) as Record<string, string>

const CRITICAL_EXPRESSION_ASSETS = Object.fromEntries(
  ['notice', 'brace', 'peak', 'overflow', 'comfort', 'recover'].map(phase => [
    `critical-r5-${phase}`,
    `${CRITICAL_EXPRESSION_ROOT}/critical-${phase}.png`,
  ]),
) as Record<string, string>

const REVIVE_ASSETS = Object.fromEntries(
  ['death-start', 'wake', 'lift', 'relief', 'hop', 'settle', 'reopen'].map(name => [
    `revive-${name}`, `${REVIVE_ROOT}/revive-${name}.png`,
  ]),
) as Record<string, string>

type IdleAction = 'blink' | 'peek' | 'tilt' | 'tail' | 'nibble'

const ACTION_DURATIONS: Record<IdleAction, number> = {
  blink: 760,
  peek: 2_850,
  tilt: 3_100,
  tail: 4_600,
  nibble: 4_800,
}

const clamp = (value: number, min = 0, max = 1): number => Math.max(min, Math.min(max, value))
const smoother = (value: number): number => {
  const x = clamp(value)
  return x * x * x * (x * (x * 6 - 15) + 10)
}
const wave = (progress: number, cycles = 1, phase = 0): number => Math.sin((progress * cycles + phase) * Math.PI * 2)
const pulse = (progress: number, start: number, end: number): number => Math.sin(Math.PI * clamp((progress - start) / (end - start)))
const envelope = (progress: number, start = 0.08, end = 0.9): number => {
  if (progress <= start) return smoother(progress / start)
  if (progress >= end) return 1 - smoother((progress - end) / (1 - end))
  return 1
}

interface Motion {
  x: number
  y: number
  angle: number
  sx: number
  sy: number
}

function idleMotion(now: number, epoch: number, strength: number): Motion {
  const t = (now - epoch) / 1_000
  return {
    x: (0.34 * wave(t, 0.13) + 0.16 * wave(t, 0.31, 0.2)) * strength,
    y: (-0.7 + 0.62 * wave(t, 0.245) + 0.14 * wave(t, 0.61, 0.35)) * strength,
    angle: (0.18 * wave(t, 0.17) + 0.08 * wave(t, 0.43, 0.4)) * strength,
    sx: 1 + 0.0013 * wave(t, 0.245, 0.5) * strength,
    sy: 1 + 0.0018 * wave(t, 0.245) * strength,
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = async () => {
      try {
        await image.decode()
      } catch {
        // onload 已确认图片可绘制；部分浏览器不实现 decode。
      }
      resolve(image)
    }
    image.onerror = () => reject(new Error(`Failed to load whale-girl asset: ${url}`))
    image.src = url
  })
}

/**
 * 鲸鱼娘固定 512px 单画布舞台。待机和旧反馈姿态均先在离屏画布完成，再一次提交可见帧。
 * @param props 当前由既有余额事件状态机选择的反馈姿态。
 * @returns 宽度由父容器固定为余额卡 80% 的透明 Canvas。
 */
const isPainPose = (pose: WhalePose): boolean => !['idle', 'heal-happy', 'revive-recharge'].includes(pose)

export function WhaleGirlStage({ pose, impactPulse = 0, onPoseComplete, syncEpoch }: WhaleGirlStageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const poseRef = useRef(pose)
  const impactPulseRef = useRef(impactPulse)
  const onPoseCompleteRef = useRef(onPoseComplete)

  useEffect(() => {
    poseRef.current = pose
  }, [pose])

  useEffect(() => {
    impactPulseRef.current = impactPulse
  }, [impactPulse])

  useEffect(() => {
    onPoseCompleteRef.current = onPoseComplete
  }, [onPoseComplete])

  useEffect(() => {
    const canvas = canvasRef.current
    if (canvas === null) return
    const context = canvas.getContext('2d', { alpha: true })
    if (context === null) return

    const buffer = document.createElement('canvas')
    buffer.width = SIZE
    buffer.height = SIZE
    const bufferContext = buffer.getContext('2d', { alpha: true })
    if (bufferContext === null) return
    context.imageSmoothingEnabled = true
    context.imageSmoothingQuality = 'high'
    bufferContext.imageSmoothingEnabled = true
    bufferContext.imageSmoothingQuality = 'high'

    let disposed = false
    let frame = 0
    let idleEpoch = syncEpoch ?? performance.now()
    let action: IdleAction | null = null
    let actionStartedAt = 0
    let nextActionAt = idleEpoch + (syncEpoch === undefined ? 2_500 + Math.random() * 2_500 : 900)
    let lastAction: IdleAction | null = null
    let showcaseActionIndex = 0
    let lastPose = poseRef.current
    let feedbackStartedAt = idleEpoch
    let lastImpactPulse = impactPulseRef.current
    let lastImpactAt = idleEpoch
    let reviveCompleted = false
    let reviveReady = false
    // 从耗尽图片切换为 Canvas 时组件会直接以 revive-recharge 首次挂载，
    // 此时不会经过后面的 pose-change 分支，所以这里也必须建立等待门禁。
    let reviveWaitingForAssets = poseRef.current === 'revive-recharge'
    let tiltSide = 1
    const images = new Map<string, HTMLImageElement>()
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')

    const draw = (image: HTMLImageElement | undefined, motion: Partial<Motion> = {}, yOffset = 0): void => {
      if (image === undefined) return
      const x = motion.x ?? 0
      const y = motion.y ?? 0
      const angle = motion.angle ?? 0
      const sx = motion.sx ?? 1
      const sy = motion.sy ?? 1
      bufferContext.save()
      bufferContext.translate(256 + x, 470 + y)
      bufferContext.rotate(angle * Math.PI / 180)
      bufferContext.scale(sx, sy)
      bufferContext.drawImage(image, -256, -470 + yOffset, SIZE, SIZE)
      bufferContext.restore()
    }

    const present = (): void => {
      context.save()
      context.globalCompositeOperation = 'copy'
      context.drawImage(buffer, 0, 0)
      context.restore()
    }

    const begin = (): void => bufferContext.clearRect(0, 0, SIZE, SIZE)
    const get = (name: string): HTMLImageElement | undefined => images.get(name)
    const poseKey = (progress: number, keys: readonly string[]): string => keys[Math.min(keys.length - 1, Math.floor(clamp(progress) * keys.length))]!

    const renderIdle = (now: number): void => {
      const motion = idleMotion(now, idleEpoch, reducedMotion.matches ? 0.18 : 1)
      motion.x = clamp(motion.x, -0.45, 0.45)
      motion.angle = clamp(motion.angle, -0.16, 0.16)
      draw(get('idle-08'), motion)
    }

    const renderAction = (name: IdleAction, progress: number, now: number): void => {
      if (name === 'blink') {
        const key = poseKey(progress, ['idle', 'half-close', 'soft', 'soft', 'reopen', 'half-close', 'idle'])
        const motion = idleMotion(now, idleEpoch, 0.18)
        motion.x = clamp(motion.x, -0.35, 0.35)
        motion.angle = clamp(motion.angle, -0.12, 0.12)
        draw(get(key === 'idle' ? 'idle-08' : `blink-${key}`), motion)
        return
      }
      if (name === 'peek') {
        const phase = progress < 0.16 ? 5 : progress < 0.4 ? 6 : progress < 0.72 ? 7 : 8
        const q = envelope(progress, 0.11, 0.86)
        const motion = idleMotion(now, idleEpoch, 0.35)
        motion.x += -3.2 * pulse(progress, 0, 0.14) + 7.2 * q + 0.9 * wave(progress, 1.65) * q * (1 - progress)
        motion.y += 6.4 * q + 1.1 * wave(progress, 2.3) * q
        motion.angle += 2.4 * q + 0.8 * wave(progress) * q
        draw(get(`acting-${String(phase).padStart(2, '0')}`), motion)
        return
      }
      if (name === 'tilt') {
        const q = envelope(progress, 0.16, 0.82)
        const settle = 1.1 * wave(progress, 2.2) * q * (1 - progress)
        const motion = idleMotion(now, idleEpoch, 0.35)
        motion.x += tiltSide * (7.8 * q + 1.2 * settle)
        motion.y += 4.8 * q
        motion.angle += tiltSide * (6.8 * q + settle)
        draw(get(q > 0.48 ? (tiltSide > 0 ? 'idle-04' : 'idle-03') : 'idle-08'), motion)
        return
      }
      if (name === 'tail') {
        const q = envelope(progress, 0.12, 0.88)
        const sway = wave(progress, 1.5)
        const motion = idleMotion(now, idleEpoch, 0.25)
        motion.x += clamp(-5.4 * sway * q, -5.4, 3.6)
        motion.y -= 5 * q
        motion.angle += (-2.35 * sway + 0.65 * wave(progress, 3, 0.18) * q * (1 - progress)) * q
        draw(get('idle-08'), motion)
        return
      }
      const phase = progress < 0.18 ? 1 : progress < 0.38 ? 2 : progress < 0.68 ? 3 : progress < 0.88 ? 2 : 4
      const q = envelope(progress, 0.1, 0.91)
      const motion = idleMotion(now, idleEpoch, 0.3)
      motion.x += -4.8 * q + 1.3 * wave(progress, 1.4) * q
      motion.y += 7.2 * q + (phase === 3 ? 1.1 * wave(progress, 5.5) : 0)
      motion.angle += -2.2 * q + 0.7 * wave(progress, 1.2) * q * (1 - progress)
      draw(get(`acting-${String(phase).padStart(2, '0')}`), motion)
    }

    const drawImpactMark = (x: number, y: number, size: number, alpha: number): void => {
      bufferContext.save()
      bufferContext.translate(x, y)
      bufferContext.globalAlpha = clamp(alpha)
      bufferContext.strokeStyle = '#ff758c'
      bufferContext.lineWidth = 4
      bufferContext.lineCap = 'round'
      for (let index = 0; index < 3; index += 1) {
        bufferContext.rotate(-Math.PI / 3)
        bufferContext.beginPath()
        bufferContext.moveTo(0, -size * 0.35)
        bufferContext.lineTo(0, -size)
        bufferContext.stroke()
      }
      bufferContext.restore()
    }

    /**
     * 反馈始终使用 V4 同身份的完整单源帧。眼睛、嘴、腮红和泪滴全部来自
     * Sota gpt-image-2 素材；运行时只画一张完整人物图，不程序绘制或叠加面部。
     * 脸区以外像素和透明轮廓逐像素继承 idle-v4-r2 母版。
     */
    const renderFeedback = (currentPose: Exclude<WhalePose, 'idle'>, now: number): void => {
      const elapsed = Math.max(0, now - feedbackStartedAt)
      const sinceImpact = Math.max(0, now - lastImpactAt)
      const progress = clamp(elapsed / 1_250)
      const impactProgress = clamp(sinceImpact / 1_250)
      const release = Math.max(envelope(progress, 0.08, 0.78), envelope(impactProgress, 0.08, 0.78))
      const motion = idleMotion(now, idleEpoch, 0.08)
      const feedbackFrame = (pain = true): HTMLImageElement | undefined => {
        if (elapsed < 80) return get('idle-08')
        if (!pain) {
          if (elapsed < 155) return get('blink-half-close')
          if (elapsed < 980) return get('blink-soft')
          if (elapsed < 1_060) return get('blink-half-close')
          if (elapsed < 1_145) return get('blink-reopen')
          return get('idle-08')
        }
        const criticalFrame = (): HTMLImageElement | undefined => {
          if (elapsed < 165) return get('critical-r5-notice')
          if (elapsed < 300) return get('critical-r5-brace')
          if (elapsed < 500 || sinceImpact < 430) return get('critical-r5-peak')
          if (elapsed < 720 || sinceImpact < 650) return get('critical-r5-overflow')
          if (sinceImpact < 940) return get('critical-r5-comfort')
          if (sinceImpact < 1_155) return get('critical-r5-recover')
          return get('idle-08')
        }
        if (currentPose === 'critical-pain' || currentPose === 'critical-combo') {
          return criticalFrame()
        }
        const level = currentPose === 'weak-pain' ? 'weak' : 'normal'
        if (elapsed < 165) return get(`${level}-half`)
        if (elapsed < 650 || sinceImpact < 650) return get(`${level}-close`)
        if (sinceImpact < 900) return get(`${level}-half`)
        if (sinceImpact < 990) return get(`${level}-close`)
        if (sinceImpact < 1_080) return get(`${level}-half`)
        if (sinceImpact < 1_155) return get(`${level}-reopen`)
        return get('idle-08')
      }

      if (currentPose === 'heal-happy') {
        motion.y -= 7.2 * pulse(progress, 0, 0.58)
        motion.x += 1.1 * wave(progress, 1.5) * release
        motion.angle += 1.25 * wave(progress, 1.5) * release
        draw(feedbackFrame(false), motion)
        bufferContext.save()
        bufferContext.globalAlpha = 0.72 * release
        bufferContext.fillStyle = '#72e6b1'
        bufferContext.font = '700 25px system-ui, sans-serif'
        bufferContext.fillText('+', 155, 345 - 9 * progress)
        bufferContext.fillText('✦', 349, 316 - 12 * progress)
        bufferContext.restore()
        return
      }

      const strength = currentPose === 'weak-pain' ? 0.5 : currentPose === 'normal-pain' ? 0.76 : 1
      const hit = Math.max(Math.exp(-elapsed / 150), Math.exp(-sinceImpact / 150) * 0.65)
      const tremble = Math.sin(elapsed * 0.105) * hit * strength
      motion.x += (-7.5 * hit + 2.2 * tremble) * strength
      motion.y += (2.4 * hit + 3.8 * pulse(progress, 0, 0.55)) * strength
      motion.angle += (-1.7 * hit + 0.55 * tremble) * strength

      if (currentPose === 'critical-combo') {
        const comboRelease = Math.max(0, 1 - progress * 1.15)
        motion.x += Math.sin(elapsed * 0.16) * comboRelease * 3.4
        motion.angle += Math.sin(elapsed * 0.11) * comboRelease * 0.7
      }
      draw(feedbackFrame(), motion)
      drawImpactMark(346, 294, 16 + 5 * strength, release * strength)
    }

    /**
     * 复苏使用六张图片模型生成的完整人物关键姿势。任意可见帧只绘制
     * 一张完整人物图；姿势停留区间仅施加刚体位移/旋转/缩放和缓动。
     */
    const renderRevive = (now: number): void => {
      if (!reviveReady) {
        // 复苏的七张完整人物帧必须作为一个原子素材组准备完毕。等待期间保留
        // 耗尽姿势，不允许时间轴越过尚未解码的关键姿势而提交透明空帧。
        draw(get('revive-death-start') ?? get('idle-08'))
        return
      }
      const elapsed = Math.max(0, now - feedbackStartedAt)
      let key = 'revive-death-start'
      const motion: Motion = { x: 0, y: 0, angle: 0, sx: 1, sy: 1 }
      if (elapsed < 220) {
        motion.y = 1.5 * smoother(elapsed / 220)
      } else if (elapsed < 720) {
        key = 'revive-wake'
        const p = (elapsed - 220) / 500
        motion.y = 3 - 3 * smoother(p)
        motion.angle = -0.8 * pulse(p, 0, 0.62)
      } else if (elapsed < 1_250) {
        key = 'revive-lift'
        const p = (elapsed - 720) / 530
        motion.y = 4 - 6 * smoother(p)
        motion.angle = 0.65 * pulse(p, 0, 0.72)
      } else if (elapsed < 1_900) {
        key = 'revive-relief'
        const p = (elapsed - 1_250) / 650
        motion.y = -2 - 1.2 * wave(p, 0.72)
        motion.angle = 0.35 * wave(p, 0.7)
      } else if (elapsed < 2_400) {
        key = 'revive-hop'
        const p = (elapsed - 1_900) / 500
        motion.y = -3 - 15 * Math.sin(Math.PI * p)
        motion.angle = -0.7 * Math.sin(Math.PI * p)
        motion.sx = 1 - 0.008 * Math.sin(Math.PI * p)
        motion.sy = 1 + 0.008 * Math.sin(Math.PI * p)
      } else if (elapsed < 2_850) {
        key = 'revive-settle'
        const p = (elapsed - 2_400) / 450
        const settle = Math.sin(p * Math.PI * 2.4) * (1 - p)
        motion.y = 3.6 * settle
        motion.sx = 1 + 0.006 * Math.max(0, settle)
        motion.sy = 1 - 0.006 * Math.max(0, settle)
      } else {
        key = 'revive-reopen'
        const p = clamp((elapsed - 2_850) / 500)
        motion.y = -0.8 * Math.sin(Math.PI * p)
      }
      draw(get(key), motion)
      if (elapsed >= 3_350 && !reviveCompleted) {
        reviveCompleted = true
        queueMicrotask(() => onPoseCompleteRef.current?.('revive-recharge'))
      }
    }

    const chooseAction = (): IdleAction => {
      if (reducedMotion.matches) return 'blink'
      if (syncEpoch !== undefined) {
        const sequence: IdleAction[] = ['blink', 'tail', 'tilt', 'peek', 'nibble']
        const selected = sequence[showcaseActionIndex % sequence.length]!
        showcaseActionIndex += 1
        return selected
      }
      const pool: IdleAction[] = ['peek', 'tilt', 'tail', 'nibble', 'blink', 'tail', 'tilt', 'nibble']
      const choices = pool.filter((candidate) => candidate !== lastAction)
      return choices[Math.floor(Math.random() * choices.length)]!
    }

    const tick = (now: number): void => {
      const currentPose = poseRef.current
      const currentImpactPulse = impactPulseRef.current
      if (currentImpactPulse !== lastImpactPulse) {
        lastImpactPulse = currentImpactPulse
        lastImpactAt = now
      }
      if (currentPose !== lastPose) {
        action = null
        idleEpoch = now
        // 痛苦强度升级不重播完整换脸时间轴；仅 idle/heal 与受击边界变化时重新起步。
        if (isPainPose(currentPose) !== isPainPose(lastPose) || currentPose === 'heal-happy' || lastPose === 'heal-happy' || currentPose === 'revive-recharge' || lastPose === 'revive-recharge') {
          feedbackStartedAt = now
        }
        if (currentPose === 'revive-recharge') {
          reviveCompleted = false
          reviveWaitingForAssets = !reviveReady
        }
        nextActionAt = now + (syncEpoch === undefined ? 2_200 + Math.random() * 2_800 : 700)
        lastPose = currentPose
      }
      if (currentPose === 'revive-recharge' && reviveWaitingForAssets && reviveReady) {
        feedbackStartedAt = now
        reviveWaitingForAssets = false
      }
      begin()
      if (currentPose === 'revive-recharge') {
        renderRevive(now)
      } else if (currentPose !== 'idle') {
        renderFeedback(currentPose, now)
      } else if (action !== null) {
        const progress = clamp((now - actionStartedAt) / ACTION_DURATIONS[action])
        renderAction(action, progress, now)
        if (progress >= 1) {
          lastAction = action
          action = null
          idleEpoch = now - 700
          nextActionAt = now + (syncEpoch === undefined ? 1_800 + Math.random() * 4_200 : 700)
        }
      } else {
        renderIdle(now)
        if (now >= nextActionAt) {
          action = chooseAction()
          if (action === 'tilt') tiltSide *= -1
          actionStartedAt = now
        }
      }
      present()
      if (!disposed) frame = requestAnimationFrame(tick)
    }

    const baseUrl = BASE_IDLE_ASSET
    const reviveDeathUrl = REVIVE_ASSETS['revive-death-start']!
    const reviveMotionUrls = Object.values(REVIVE_ASSETS).filter((url) => url !== reviveDeathUrl)
    const backgroundUrls = [
      ...Object.values(IDLE_ASSETS),
      ...Object.values(FEEDBACK_EXPRESSION_ASSETS),
      ...Object.values(CRITICAL_EXPRESSION_ASSETS),
    ]
      .filter((url) => url !== baseUrl)
    loadImage(baseUrl).then((baseImage) => {
      if (disposed) return
      images.set(baseUrl, baseImage)
      images.set('idle-08', baseImage)
      frame = requestAnimationFrame(tick)
      // 先准备耗尽帧，Canvas 替换耗尽图片后仍保持同一叙事姿势；其余六帧
      // 作为原子素材组全部解码完毕后才开放复苏时间轴。
      return loadImage(reviveDeathUrl)
    }).then((deathImage) => {
      if (disposed || deathImage === undefined) return
      images.set(reviveDeathUrl, deathImage)
      images.set('revive-death-start', deathImage)
      return Promise.all(reviveMotionUrls.map(async (url) => [url, await loadImage(url)] as const))
    }).then((reviveLoaded) => {
      if (disposed || reviveLoaded === undefined) return
      for (const [url, image] of reviveLoaded) images.set(url, image)
      for (const [name, url] of Object.entries(REVIVE_ASSETS)) images.set(name, images.get(url)!)
      reviveReady = true
      return Promise.all(backgroundUrls.map(async (url) => [url, await loadImage(url)] as const))
    }).then((loaded) => {
      if (disposed || loaded === undefined) return
      for (const [url, image] of loaded) images.set(url, image)
      for (const [name, url] of Object.entries(IDLE_ASSETS)) images.set(name, images.get(url)!)
      for (const [name, url] of Object.entries(FEEDBACK_EXPRESSION_ASSETS)) images.set(name, images.get(url)!)
      for (const [name, url] of Object.entries(CRITICAL_EXPRESSION_ASSETS)) images.set(name, images.get(url)!)
    }).catch((error: unknown) => {
      if (!disposed) console.error(error)
    })

    return () => {
      disposed = true
      cancelAnimationFrame(frame)
    }
  }, [])

  return <canvas ref={canvasRef} width={SIZE} height={SIZE} style={{ display: 'block', width: '100%', height: '100%' }} />
}
