/**
 * 血条配色预设。
 *
 * wire 上只传颜色 id（见 contract 的 `TOKEN_MONITOR_HEALTH_BAR_COLORS`），具体渐变留在
 * Client：换色板、微调色值都不需要动设置契约或做数据迁移。
 *
 * 每个预设只声明「亮 / 主 / 深」三档与一个光晕色，填充、残影、受击特效的辉光全部
 * 从这三档派生，避免同一套配色在多处各写一遍。
 *
 * @module @deepseek-ai/dsh-client-ui-token-monitor/client
 */
import type { TokenMonitorHealthBarColor } from '../../../../util/token-monitor-contract/src/index.ts'

export interface HealthBarPalette {
  id: TokenMonitorHealthBarColor
  /** 菜单与提示里的中文名。 */
  label: string
  /** 顶部高光；同时用作冲击环与火花的亮色。 */
  light: string
  /** 血条中段主色。 */
  base: string
  /** 血条底部深色。 */
  deep: string
  /** 血条外发光与火花辉光。 */
  glow: string
  /** 血条填充渐变。 */
  fill: string
  /** 被扣掉那一段的残影：白热顶 → 该配色的亮色。 */
  trail: string
}

type PresetSeed = Omit<HealthBarPalette, 'fill' | 'trail'>

const SEEDS: readonly PresetSeed[] = [
  { id: 'red', label: '红', light: '#ff7a6b', base: '#e03127', deep: '#a81b11', glow: 'rgba(255, 59, 48, 0.55)' },
  { id: 'green', label: '绿', light: '#7ce8a4', base: '#22a35c', deep: '#146b3f', glow: 'rgba(46, 200, 112, 0.55)' },
  { id: 'blue', label: '蓝', light: '#7cc0ff', base: '#2a7fe0', deep: '#144f8f', glow: 'rgba(56, 140, 255, 0.55)' },
  { id: 'amber', label: '琥珀', light: '#ffd77a', base: '#eb9a10', deep: '#a86205', glow: 'rgba(240, 176, 32, 0.55)' },
  { id: 'violet', label: '紫', light: '#c9a6ff', base: '#8b5cf6', deep: '#4f27a3', glow: 'rgba(150, 100, 255, 0.55)' },
  { id: 'cyan', label: '青', light: '#8ff0ef', base: '#17b8bd', deep: '#0a6f74', glow: 'rgba(30, 200, 205, 0.55)' },
  { id: 'rose', label: '玫红', light: '#ffa6d0', base: '#e8438f', deep: '#9c1a56', glow: 'rgba(240, 80, 150, 0.55)' },
]

function complete(seed: PresetSeed): HealthBarPalette {
  return {
    ...seed,
    fill: `linear-gradient(180deg, ${seed.light} 0%, ${seed.base} 46%, ${seed.deep} 100%)`,
    trail: `linear-gradient(180deg, rgba(255,255,255,0.92) 0%, ${seed.light} 100%)`,
  }
}

/** 菜单渲染顺序，与 contract 的预设顺序一致。 */
export const HEALTH_BAR_PALETTES: readonly HealthBarPalette[] = SEEDS.map(complete)

const BY_ID = new Map<string, HealthBarPalette>(HEALTH_BAR_PALETTES.map(palette => [palette.id, palette]))

/** 取预设；未知或缺失（设置尚未加载）时回落到第一个预设。 */
export function healthBarPalette(id: TokenMonitorHealthBarColor | undefined): HealthBarPalette {
  const fallback = HEALTH_BAR_PALETTES[0]
  if (fallback === undefined) throw new Error('health bar palette table is empty')
  return (id === undefined ? undefined : BY_ID.get(id)) ?? fallback
}
