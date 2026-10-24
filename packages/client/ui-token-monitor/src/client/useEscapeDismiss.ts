import { useEffect, useRef } from 'react'

/**
 * 标记插件的自绘弹层（含 portal 出去的浮层）。
 *
 * 宿主弹层与插件弹层可能同屏，Esc 归属要能区分「谁是我的」。带 data 属性的
 * 层直接标记；宿主 Menu 原语只透传 class 的地方用这个类名。
 */
export const PLUGIN_LAYER_CLASS = 'tm-plugin-owned-layer'

/**
 * 全局 ESC 关闭：共享弹层栈 + 单个 window 捕获监听。
 *
 * 宿主的 Modal / Menu 原语把 Esc 监听挂在 document 上。为了既让宿主能收到
 * Esc、又避免一次按键连关两层，这里按「谁真的在最上层」分档处理：
 *
 * - 没有宿主弹层打开时：只 `preventDefault()`、不阻断传播，宿主自己的
 *   Esc 处理（window/document 上的全局监听）照常工作。
 * - 宿主弹层（Modal 或 Menu）**确实盖在插件层之上**时：让位——插件层不动，
 *   不阻断传播，由宿主关闭自己的弹层。
 * - 插件层确实在最上层、宿主弹层在它下面时：插件层响应，并阻断传播，
 *   避免把用户看不见的宿主弹层一起关掉。
 *
 * 供自绘弹层（通知设置、计费规则、详细用量窗口、悬浮卡右键菜单等）补齐
 * 与宿主一致的行为；宿主 Modal / Menu 自身不需要接入。
 * @param active 弹层是否处于打开状态；false 时不登记。
 * @param onEscape 该弹层成为最上层时、用户按下 Esc 执行的动作。
 * @param options.element 该弹层的根元素，用于命中测试判断它是否在最上层。
 * @param options.zIndex 该弹层的层级，参与插件内部与宿主的叠放比较。
 */
export function useEscapeDismiss(
  active: boolean,
  onEscape: () => void,
  options: { element?: () => HTMLElement | null; zIndex?: number } = {},
): void {
  const handler = useRef(onEscape)
  handler.current = onEscape
  const element = useRef(options.element)
  element.current = options.element
  const zIndex = options.zIndex
  useEffect(() => {
    if (!active) return
    const layer: Layer = {
      zIndex: zIndex ?? 0,
      getElement: () => element.current?.() ?? null,
      onEscape: () => { handler.current() },
    }
    layers.push(layer)
    ensureListener()
    return () => {
      const index = layers.indexOf(layer)
      if (index >= 0) layers.splice(index, 1)
      releaseListener()
    }
  }, [active, zIndex])
}

interface Layer {
  zIndex: number
  getElement(): HTMLElement | null
  onEscape(): void
}

/** 同时登记的弹层；目标层按视觉层级选，不按挂载顺序。 */
const layers: Layer[] = []
let listening = false

function onKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Escape') return
  // 输入法组合期间按 Esc 是「取消候选」，不能顺手关掉弹层、丢掉未保存编辑。
  // 旧版 WebKit/Chromium 在组合态给的是 keyCode 229，一并放行。
  if (event.isComposing || event.keyCode === 229) return
  const top = topMostLayer()
  if (!top) return
  if (hostOverlayAbove(top)) {
    // 宿主的弹层（Modal 或 Menu）真的盖在插件层上面：Esc 归宿主，
    // 插件层保持原样，也不阻断传播（宿主 document 上的监听要靠它关闭自己）。
    return
  }
  event.preventDefault()
  if (hostOverlayPresent()) {
    // 插件层在上、宿主弹层在下面：只关插件层，阻断传播避免连关看不见的那层。
    event.stopPropagation()
  }
  top.onEscape()
}

/**
 * 选出插件自己的最上层弹层。
 *
 * 只按挂载顺序取栈顶会关错层：先开的详细用量（1300）可能压在后开的通知
 * 设置（1200）之上。层级相同时仍按挂载顺序，后开的先关。
 * @returns 视觉上最上层的插件弹层。
 */
function topMostLayer(): Layer | undefined {
  let top: Layer | undefined
  for (const layer of layers) {
    if (top === undefined || layer.zIndex >= top.zIndex) top = layer
  }
  return top
}

/** 宿主弹层的稳定选择器：Modal 是模态对话框，Menu/listbox 是宿主浮层。 */
const HOST_OVERLAY_SELECTOR = '[role="dialog"][aria-modal="true"], [role="menu"], [role="listbox"]'

/** 页面上是否存在宿主弹层（Modal 或 Menu）。 */
function hostOverlayPresent(): boolean {
  return hostOverlayElements().length > 0
}

/**
 * 宿主弹层中不属于插件、且确实以浮层形式叠放的那一层。
 *
 * 带 role=menu/listbox 的元素也可能是页面里的普通内联控件；只有定位成
 * fixed/absolute 并带明确层级时才当作浮层，避免误把别处的控件算成宿主弹层。
 */
function hostOverlayElements(): Element[] {
  return [...document.querySelectorAll(HOST_OVERLAY_SELECTOR)]
    .filter(node => !isPluginOwned(node)
      // 模态对话框本身就是浮层；menu/listbox 可能是内联控件，要求确实在叠放。
      && (node.getAttribute('aria-modal') === 'true' || isStackedOverlay(node)))
}

/** 元素是否以浮层形式参与叠放（定位 + 明确 z-index）。 */
function isStackedOverlay(node: Element): boolean {
  const style = window.getComputedStyle(node)
  if (style.position !== 'fixed' && style.position !== 'absolute') return false
  return Number.isFinite(Number.parseInt(style.zIndex, 10))
}

/** 元素是否属于插件的自绘弹层（含 portal 出去的浮层）。 */
function isPluginOwned(node: Element | null): boolean {
  let current: Element | null = node
  while (current !== null) {
    if (current.hasAttribute('data-token-monitor-layer')) return true
    if (current.classList.contains(PLUGIN_LAYER_CLASS)) return true
    if (layers.some(layer => layer.getElement() === current)) return true
    current = current.parentElement
  }
  return false
}

/**
 * 插件层是否真的在宿主弹层之上。
 *
 * 优先在插件层中心点做命中测试：命中的元素属于插件（含它自己的 portal
 * 浮层）即说明它没被盖住。命中测试不可用（未挂载、环境未实现）时回退到
 * 计算样式的层级比较。
 * @param layer 参与比较的插件弹层。
 * @returns 插件层在宿主弹层之上时为 true。
 */
function layerAboveHostModal(layer: Layer): boolean {
  const element = layer.getElement()
  if (element === null) return layer.zIndex >= hostOverlayStackingZ()
  const rect = element.getBoundingClientRect()
  const x = rect.left + rect.width / 2
  const y = rect.top + rect.height / 2
  if (rect.width > 0 && rect.height > 0 && Number.isFinite(x) && Number.isFinite(y)) {
    const hit = document.elementFromPoint(x, y)
    // 命中插件自己的任意浮层（例如费用浮层）也算插件在上：同一个组件
    // 的浮层 portal 到 body 后不再是窗口的子元素，但语义上属于它。
    if (hit !== null) return isPluginOwned(hit)
  }
  // 命中测试不可用：比较各自参与的叠放层。
  return stackingZIndexOf(element) >= hostOverlayStackingZ()
}

/**
 * 宿主弹层是否真的盖在给定插件层之上。
 * @param layer 参与比较的插件弹层。
 * @returns 宿主弹层在上（或无法判断为插件在上）时为 true。
 */
function hostOverlayAbove(layer: Layer): boolean {
  return hostOverlayPresent() && !layerAboveHostModal(layer)
}

/**
 * 读取元素实际参与叠放的层级：取自身及祖先中**最外层**明确的 z-index。
 *
 * 宿主 Modal 的 `role="dialog"` 卡片自身是 `z-index: 1`，真正的层级在带
 * `z-index: 1000` 的根层祖先上；只读卡片会得出相反的结论，因此这里一路
 * 向上取最外层（最接近文档根）的明确层级。
 */
function stackingZIndexOf(node: Element): number {
  let stacking = 0
  let current: Element | null = node
  while (current !== null) {
    const value = Number.parseInt(window.getComputedStyle(current).zIndex, 10)
    if (Number.isFinite(value) && value !== 0) stacking = value
    current = current.parentElement
  }
  return stacking
}

/** 宿主弹层实际参与叠放的层级（取最高者）。 */
function hostOverlayStackingZ(): number {
  let highest = 0
  for (const overlay of hostOverlayElements()) {
    highest = Math.max(highest, stackingZIndexOf(overlay))
  }
  return highest
}

function ensureListener(): void {
  if (listening) return
  listening = true
  window.addEventListener('keydown', onKeydown, true)
}

function releaseListener(): void {
  if (!listening || layers.length > 0) return
  listening = false
  window.removeEventListener('keydown', onKeydown, true)
}
