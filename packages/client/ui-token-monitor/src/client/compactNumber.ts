const COMPACT_NUMBER_UNITS = [
  { threshold: 1_000_000_000_000, divisor: 1_000_000_000_000, suffix: '万亿' },
  { threshold: 100_000_000, divisor: 100_000_000, suffix: '亿' },
  { threshold: 10_000_000, divisor: 10_000_000, suffix: '千万' },
  { threshold: 10_000, divisor: 10_000, suffix: '万' },
] as const

function trimFraction(value: number): string {
  return value.toFixed(2).replace(/\.?0+$/, '')
}

function findCompactUnit(absolute: number) {
  const index = COMPACT_NUMBER_UNITS.findIndex(candidate => absolute >= candidate.threshold)
  if (index < 0) return undefined

  const unit = COMPACT_NUMBER_UNITS[index]
  if (unit === undefined) return undefined
  const largerIndex = index - 1
  const largerUnit = largerIndex >= 0 ? COMPACT_NUMBER_UNITS[largerIndex] : undefined
  const roundedValue = Number((absolute / unit.divisor).toFixed(2))
  return largerUnit !== undefined && roundedValue * unit.divisor >= largerUnit.threshold ? largerUnit : unit
}

/**
 * Format a finite number with Chinese compact units, falling back to zero for invalid input.
 * @param value - Untrusted value to validate or format.
 * @returns The locale-formatted compact number.
 */
export function formatChineseCompactNumber(value: number): string {
  if (!Number.isFinite(value)) return '0'
  const sign = value < 0 ? '-' : ''
  const absolute = Math.abs(value)
  const unit = findCompactUnit(absolute)
  if (unit === undefined) return value.toLocaleString('zh-CN', { maximumFractionDigits: 2 })
  return `${sign}${trimFraction(absolute / unit.divisor)}${unit.suffix}`
}

/**
 * Format a currency amount with two decimals below the compact-unit threshold.
 * @param value - Untrusted value to validate or format.
 * @returns The formatted currency amount without a currency symbol.
 */
export function formatChineseCompactCurrency(value: number): string {
  if (!Number.isFinite(value)) return '0.00'
  if (Math.abs(value) < 10_000) {
    return value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  }
  return formatChineseCompactNumber(value)
}
