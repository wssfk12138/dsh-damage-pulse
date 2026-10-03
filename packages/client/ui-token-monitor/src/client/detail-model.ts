/** Browser-independent formatting and viewport constraints for the usage window. */
export interface WindowRect { x: number; y: number; width: number; height: number }
/** Viewport edges that a resize gesture may move. */
export type ResizeEdge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'
/**
 * Resize the selected edges while anchoring the opposite edges inside the viewport.
 * @param rect - Current window rectangle.
 * @param edge - Window edge or corner moved by the gesture.
 * @param dx - Horizontal pointer delta in pixels.
 * @param dy - Vertical pointer delta in pixels.
 * @param width - Available viewport width in pixels.
 * @param height - Available viewport height in pixels.
 * @param topInset - Reserved host title-bar space in pixels; defaults to 8.
 * @returns The resized rectangle constrained to the viewport.
 */
export function resizeWindow(rect: WindowRect, edge: ResizeEdge, dx: number, dy: number, width: number, height: number, topInset = 8): WindowRect {
  let { x, y, width: w, height: h } = rect
  const minWidth = Math.min(320, Math.max(0, width - 16)), minHeight = Math.min(280, Math.max(0, height - topInset - 8))
  if (edge.includes('w')) {
    x = Math.max(8, Math.min(rect.x + dx, rect.x + rect.width - minWidth))
    w = rect.x + rect.width - x
  }
  if (edge.includes('e')) w = Math.max(minWidth, Math.min(rect.width + dx, width - rect.x - 8))
  if (edge.includes('n')) {
    y = Math.max(topInset, Math.min(rect.y + dy, rect.y + rect.height - minHeight))
    h = rect.y + rect.height - y
  }
  if (edge.includes('s')) h = Math.max(minHeight, Math.min(rect.height + dy, height - rect.y - 8))
  return { x, y, width: w, height: h }
}
/**
 * Clamp a detail window to the visible viewport and supported minimum size.
 * @param rect - Current window rectangle.
 * @param width - Available viewport width in pixels.
 * @param height - Available viewport height in pixels.
 * @param topInset - Reserved host title-bar space; small viewports shrink below the preferred minimum size.
 * @returns The nearest supported rectangle inside the viewport.
 */
export function clampWindow(rect: WindowRect, width: number, height: number, topInset = 8): WindowRect {
  const w = Math.min(Math.max(320, rect.width), Math.max(0, width - 16))
  const h = Math.min(Math.max(280, rect.height), Math.max(0, height - topInset - 8))
  return { x: Math.max(8, Math.min(rect.x, width - w - 8)), y: Math.max(topInset, Math.min(rect.y, height - h - 8)), width: w, height: h }
}
/**
 * Format a token count with K or M suffixes for the detail view.
 * @param n - Token count to format.
 * @returns The compact token-count label.
 */
export function compactTokens(n: number): string {
  return n >= 1_000_000 ? (n / 1_000_000).toFixed(2) + 'M' : n >= 1000 ? (n / 1000).toFixed(1) + 'K' : String(n)
}
/**
 * Classify request latency for the detail view's status styling.
 * @param ms - Observed latency in milliseconds, or undefined when unavailable.
 * @param total - Whether to use the total-request latency thresholds.
 * @returns The display tone for the supplied latency.
 */
export function latencyTone(ms: number | undefined, total = false): 'unknown' | 'good' | 'warn' | 'bad' {
  if (ms === undefined) return 'unknown'
  return ms <= (total ? 60000 : 5000) ? 'good' : ms <= (total ? 180000 : 15000) ? 'warn' : 'bad'
}
/**
 * Format an epoch timestamp as a timezone-free Beijing date-time field value.
 * @param time - Epoch timestamp in milliseconds.
 * @returns A yyyy-MM-ddTHH:mm:ss string interpreted as Beijing time.
 */
export function beijingDateTime(time: number): string { return new Date(time + 8 * 3600_000).toISOString().slice(0, 19) }
/**
 * Parse a timezone-free Beijing date-time field value into an epoch timestamp.
 * @param value - Untrusted value to validate or format.
 * @returns The parsed epoch timestamp in milliseconds.
 */
export function parseBeijing(value: string): number { return Date.parse(value + '+08:00') }
