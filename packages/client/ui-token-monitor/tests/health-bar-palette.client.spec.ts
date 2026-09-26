// @vitest-environment jsdom

/**
 * The palette table is the Client half of the colour setting: the wire only carries a
 * preset id, so this table is what turns that id into pixels. Two failure modes are
 * worth pinning — a preset the contract accepts but the table lacks (the user picks a
 * colour and the bar silently keeps the default), and two presets that render alike
 * (the menu offers choices that look identical).
 */
import { describe, expect, it } from 'vitest'
import { TOKEN_MONITOR_HEALTH_BAR_COLORS } from '../../../util/token-monitor-contract/src/index.ts'
import { HEALTH_BAR_PALETTES, healthBarPalette } from '../src/client/healthBarPalette.ts'

describe('health bar palette', () => {
  it('covers exactly the ids the wire contract accepts', () => {
    expect(HEALTH_BAR_PALETTES.map(entry => entry.id)).toEqual([...TOKEN_MONITOR_HEALTH_BAR_COLORS])
  })

  it('gives every preset a distinct fill derived from its own swatch colours', () => {
    expect(new Set(HEALTH_BAR_PALETTES.map(entry => entry.fill)).size).toBe(HEALTH_BAR_PALETTES.length)
    for (const entry of HEALTH_BAR_PALETTES) {
      expect(entry.label.length).toBeGreaterThan(0)
      expect(entry.fill).toContain(entry.light)
      expect(entry.fill).toContain(entry.deep)
      // 残影必须带上自己的主色，否则换色后残影还是红的。
      expect(entry.trail).toContain(entry.light)
      expect(entry.glow).toContain('rgba(')
    }
  })

  it('falls back to the first preset for a missing or unknown id', () => {
    const fallback = HEALTH_BAR_PALETTES[0]

    // Settings have not arrived yet on the first frame.
    expect(healthBarPalette(undefined)).toBe(fallback)
    // A Host that somehow stored something else must not blank the bar.
    expect(healthBarPalette('chartreuse' as never)).toBe(fallback)
    expect(healthBarPalette('violet').id).toBe('violet')
    expect(fallback?.id).toBe('red')
  })
})
