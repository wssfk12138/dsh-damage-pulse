/** Floating-window geometry shared by the plugin's panels.
 *
 * The usage details window and the billing rules window are the same kind of
 * surface: a non-modal card the user can drag by its title bar, resize from
 * any of its eight borders, maximize, and find again where it was left. Both
 * windows therefore drive one implementation instead of copying the pointer
 * and keyboard handling.
 */
import { useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { clampWindow, resizeWindow, type ResizeEdge, type WindowRect } from './detail-model.ts'

/** Resize borders in paint order; the south-east corner also paints a grip glyph. */
export const resizeEdges: readonly ResizeEdge[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']

/** Minimum distance an overlay keeps from the viewport edges. */
const overlayMargin = 8

/**
 * Resolve the top margin an overlay keeps on this frame.
 * The desktop shell publishes its title strip height so JS-positioned overlays
 * do not land underneath the drag region; a plain browser keeps the minimum.
 * @param min - The overlay's own viewport margin in pixels.
 * @returns The larger of `min` and the frame's published top clearance.
 */
export function overlayTopMargin(min: number): number {
  const clearance = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--dsh-frame-top-clearance'))
  return Number.isNaN(clearance) ? min : Math.max(min, clearance)
}

/** One floating window's geometry and the pointer handlers that move it. */
export interface FloatingWindow {
  /** The rectangle the window paints: the stored one, or the viewport inset while maximized. */
  shown: WindowRect
  /** Whether the window currently fills the viewport. */
  maximized: boolean
  /** Switch between the stored rectangle and the maximized inset. */
  toggleMaximized: () => void
  /**
   * Begin a window drag, or a border resize when `edge` is given.
   * @param event - The pointerdown starting the gesture.
   * @param edge - The border to resize; omitted moves the whole window.
   */
  startDrag: (event: ReactPointerEvent<HTMLElement>, edge?: ResizeEdge) => void
  /** Continue the drag or resize that {@link FloatingWindow.startDrag} began. */
  moveDrag: (event: ReactPointerEvent<HTMLElement>) => void
  /** Forget the in-flight gesture, for pointerup, pointercancel and lost capture. */
  endDrag: () => void
  /**
   * Resize from the keyboard, which reaches the borders a pointer-only gesture cannot.
   * @param edge - The border to move.
   * @param dx - Horizontal step in pixels.
   * @param dy - Vertical step in pixels.
   */
  nudge: (edge: ResizeEdge, dx: number, dy: number) => void
}

/**
 * Read the remembered rectangle, falling back to the caller's default.
 * @param key - Local-storage key holding the last rectangle.
 * @param fallback - Rectangle used before the user has moved the window.
 * @returns A rectangle already clamped into the current viewport.
 */
function storedRect(key: string, fallback: WindowRect): WindowRect {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? 'null')
    if (value && typeof value === 'object' && 'x' in value && 'y' in value && 'width' in value && 'height' in value) {
      const { x, y, width, height } = value
      if (typeof x === 'number' && typeof y === 'number' && typeof width === 'number' && typeof height === 'number'
        && [x, y, width, height].every(Number.isFinite)) return clampWindow({ x, y, width, height }, innerWidth, innerHeight)
    }
  } catch { /* A disabled storage backend should not block the window. */ }
  return clampWindow(fallback, innerWidth, innerHeight)
}

/**
 * Own one draggable window's rectangle, maximized flag and persistence.
 * @param storageKey - Local-storage key holding the last rectangle.
 * @param fallback - Rectangle used before the user has moved the window.
 * @returns The geometry and pointer handlers described by {@link FloatingWindow}.
 */
export function useFloatingWindow(storageKey: string, fallback: WindowRect): FloatingWindow {
  const [rect, setRect] = useState(() => storedRect(storageKey, fallback))
  const [maximized, setMaximized] = useState(false)
  const [viewport, setViewport] = useState({ width: innerWidth, height: innerHeight })
  const drag = useRef<{ x: number; y: number; rect: WindowRect; edge: ResizeEdge | undefined }>()
  useEffect(() => {
    const resize = () => {
      setViewport({ width: innerWidth, height: innerHeight })
      setRect(value => clampWindow(value, innerWidth, innerHeight))
    }
    window.addEventListener('resize', resize)
    return () => { window.removeEventListener('resize', resize) }
  }, [])
  useEffect(() => {
    try { localStorage.setItem(storageKey, JSON.stringify(rect)) } catch { /* Optional viewing preference. */ }
  }, [storageKey, rect])
  // 最大化同样要避开桌面外壳的标题条：外壳把标题条高度发布为 --dsh-frame-top-clearance。
  // 只按四边等距 inset 时，浮窗自己的「还原 / 关闭」按钮会落在桌面窗口按钮下面，用户点不到。
  const topInset = overlayTopMargin(overlayMargin)
  const shown = maximized
    ? { x: overlayMargin, y: topInset, width: viewport.width - overlayMargin * 2, height: viewport.height - topInset - overlayMargin }
    : rect
  return {
    shown,
    maximized,
    toggleMaximized: () => { setMaximized(value => !value) },
    startDrag: (event, edge) => {
      if (maximized || event.button !== 0 || (event.target as HTMLElement).closest('button') !== null) return
      drag.current = { x: event.clientX, y: event.clientY, rect, edge }
      event.currentTarget.setPointerCapture(event.pointerId)
      event.preventDefault()
    },
    moveDrag: (event) => {
      const start = drag.current
      if (!start) return
      const dx = event.clientX - start.x, dy = event.clientY - start.y
      const next = start.edge
        ? resizeWindow(start.rect, start.edge, dx, dy, innerWidth, innerHeight)
        : { ...start.rect, x: start.rect.x + dx, y: start.rect.y + dy }
      setRect(clampWindow(next, innerWidth, innerHeight))
    },
    endDrag: () => { drag.current = undefined },
    nudge: (edge, dx, dy) => { setRect(value => resizeWindow(value, edge, dx, dy, innerWidth, innerHeight)) },
  }
}

/**
 * Render the eight border handles that drag-resize a floating window, plus the
 * arrow-key resize that keeps every border reachable without a pointer.
 * @param props.frame - The window geometry the handles drive.
 * @param props.label - Accessible name for one border, e.g. "Resize window · Bottom right".
 * @param props.className - The owner's CSS-module class for a handle.
 * @returns The handles, or nothing while the window is maximized.
 */
export function FloatingResizeHandles({ frame, label, className }: {
  frame: FloatingWindow
  label: (edge: ResizeEdge) => string
  className: string | undefined
}) {
  if (frame.maximized) return null
  return <>{resizeEdges.map(edge => <div key={edge} role="separator" aria-label={label(edge)}
    tabIndex={0} className={className} data-edge={edge}
    onPointerDown={(event) => { frame.startDrag(event, edge) }} onPointerMove={frame.moveDrag}
    onPointerUp={frame.endDrag} onPointerCancel={frame.endDrag} onLostPointerCapture={frame.endDrag}
    onKeyDown={(event) => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
      event.preventDefault()
      const dx = event.key === 'ArrowRight' ? 20 : event.key === 'ArrowLeft' ? -20 : 0
      const dy = event.key === 'ArrowDown' ? 20 : event.key === 'ArrowUp' ? -20 : 0
      frame.nudge(edge, dx, dy)
    }}>{edge === 'se' ? '◢' : null}</div>)}</>
}
