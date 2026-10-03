// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { clampWindow, resizeWindow } from '../src/client/detail-model.ts'
import { resizeEdges, useFloatingWindow } from '../src/client/window-frame.tsx'

afterEach(() => { cleanup(); vi.unstubAllGlobals(); localStorage.clear(); document.documentElement.style.removeProperty('--dsh-frame-top-clearance') })

describe('floating panels below the desktop title strip', () => {
  const fallback = { x: 12, y: 12, width: 696, height: 696 }
  it('fits a restored 720px panel below the 40px strip', () => {
    expect(clampWindow(fallback, 720, 720, 40)).toEqual({ x: 12, y: 40, width: 696, height: 672 })
    expect(clampWindow(fallback, 240, 220, 40)).toEqual({ x: 8, y: 40, width: 224, height: 172 })
  })
  it.each(resizeEdges)('keeps border %s within the safe viewport', edge => {
    for (const delta of [-2000, 2000]) {
      const rect = resizeWindow({ x: 100, y: 100, width: 400, height: 400 }, edge, delta, delta, 720, 720, 40)
      expect(rect.x).toBeGreaterThanOrEqual(8)
      expect(rect.y).toBeGreaterThanOrEqual(40)
      expect(rect.x + rect.width).toBeLessThanOrEqual(712)
      expect(rect.y + rect.height).toBeLessThanOrEqual(712)
    }
  })
  it('clamps persisted state, keyboard resizing, maximize/restore and viewport resize', () => {
    vi.stubGlobal('innerWidth', 720); vi.stubGlobal('innerHeight', 720)
    document.documentElement.style.setProperty('--dsh-frame-top-clearance', '40px')
    localStorage.setItem('frame-test', JSON.stringify(fallback))
    const { result } = renderHook(() => useFloatingWindow('frame-test', fallback))
    expect(result.current.shown.y).toBe(40)
    act(() => result.current.nudge('n', 0, -1000))
    expect(result.current.shown.y).toBe(40)
    const restored = result.current.shown
    act(() => result.current.toggleMaximized())
    expect(result.current.shown).toEqual({ x: 8, y: 40, width: 704, height: 672 })
    act(() => result.current.toggleMaximized())
    expect(result.current.shown).toEqual(restored)
    act(() => { vi.stubGlobal('innerHeight', 400); window.dispatchEvent(new Event('resize')) })
    expect(result.current.shown.y).toBe(40)
    expect(result.current.shown.y + result.current.shown.height).toBe(392)
    expect(JSON.parse(localStorage.getItem('frame-test')!)).toEqual(result.current.shown)
  })
})
