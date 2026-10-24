// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { StrictMode, useState } from 'react'
import { useEscapeDismiss } from '../src/client/useEscapeDismiss.ts'

const flush = async () => { await act(async () => {}) }
// 真实按键派发在 DOM 元素上，事件路径 window → document → body，
// 这样宿主挂在 document 上的监听与插件的 window 捕获监听都能收到。
const esc = () => fireEvent.keyDown(document.body, { key: 'Escape' })

afterEach(() => { cleanup(); vi.restoreAllMocks() })

/** 挂载一个登记弹层的探针组件，记录 onEscape 调用。 */
function Layer({ active, onEscape, zIndex }: { active: boolean; onEscape: () => void; zIndex?: number }) {
  useEscapeDismiss(active, onEscape, { zIndex })
  return null
}

it('forwards Escape to document listeners of the host while handling its own layer', () => {
  // 复现 review 第 1 条：宿主 Modal/Menu 的监听挂在 document 上，
  // 插件弹层打开时同一个 Esc 必须仍能到达那里。
  const hostListener = vi.fn()
  document.addEventListener('keydown', hostListener)
  const onEscape = vi.fn()
  render(<Layer active onEscape={onEscape} />)
  esc()
  expect(onEscape).toHaveBeenCalledTimes(1)
  expect(hostListener).toHaveBeenCalledTimes(1)
  document.removeEventListener('keydown', hostListener)
})

it('closes the top-most layer first and unwinds one layer per Escape', async () => {
  // 复现 review 第 2 条：两个自绘窗口同时打开时，Esc 关的是后打开（最上层）。
  const first = vi.fn(), second = vi.fn()
  function TwoLayers() {
    const [a, setA] = useState(true), [b, setB] = useState(true)
    useEscapeDismiss(a, () => { first(); setA(false) })
    useEscapeDismiss(b, () => { second(); setB(false) })
    return null
  }
  render(<TwoLayers />)
  esc(); await flush()
  expect(second).toHaveBeenCalledTimes(1)
  expect(first).not.toHaveBeenCalled()
  esc(); await flush()
  expect(first).toHaveBeenCalledTimes(1)
  expect(second).toHaveBeenCalledTimes(1)
  esc(); await flush()
  expect(first).toHaveBeenCalledTimes(1)
  expect(second).toHaveBeenCalledTimes(1)
})

it('stops listening after the last layer unmounts, including through StrictMode remounts', async () => {
  const add = vi.spyOn(window, 'addEventListener'), remove = vi.spyOn(window, 'removeEventListener')
  const view = render(<StrictMode><Layer active onEscape={() => {}} /></StrictMode>)
  await flush()
  view.unmount()
  // 严格模式双挂载会成对登记/移除，最后一层卸载后监听必须被移除。
  const adds = add.mock.calls.filter(([type]) => type === 'keydown')
  const removes = remove.mock.calls.filter(([type]) => type === 'keydown')
  expect(adds).toHaveLength(removes.length)
})

it('deactivates a layer without touching the others', () => {
  const first = vi.fn(), second = vi.fn()
  const view = render(<><Layer active onEscape={first} /><Layer active onEscape={second} /></>)
  view.rerender(<><Layer active onEscape={first} /><Layer active={false} onEscape={second} /></>)
  esc()
  expect(first).toHaveBeenCalledTimes(1)
  expect(second).not.toHaveBeenCalled()
})

it('lets a visible plugin layer handle Escape and keeps the hidden host modal open', async () => {
  // 复现真实宿主结构：Modal 的卡片自身 z-index 是 1，真正参与叠放的
  // 根层祖先才是 1000（插件窗口 1300 在它之上）。
  const onEscape = vi.fn()
  const hostListener = vi.fn()
  document.addEventListener('keydown', hostListener)
  const view = render(<>
    <Layer active onEscape={onEscape} zIndex={1300} />
    <div data-host-root style={{ position: 'fixed', zIndex: 1000 }}>
      <div role="dialog" aria-modal="true" style={{ zIndex: 1 }} />
    </div>
  </>)
  // 插件窗口在上：只关插件层，宿主模态不能被连关（阻断传播）。
  esc(); await flush()
  expect(onEscape).toHaveBeenCalledTimes(1)
  expect(hostListener).not.toHaveBeenCalled()
  view.unmount()
  document.removeEventListener('keydown', hostListener)
})

it('yields Escape when the host modal really is above the plugin layer', async () => {
  const onEscape = vi.fn()
  const hostListener = vi.fn()
  document.addEventListener('keydown', hostListener)
  render(<>
    <Layer active onEscape={onEscape} zIndex={1300} />
    <div data-host-root style={{ position: 'fixed', zIndex: 2000 }}>
      <div role="dialog" aria-modal="true" style={{ zIndex: 1 }} />
    </div>
  </>)
  // 宿主模态在上：插件层保持原样，宿主自己关闭（监听正常收到）。
  esc(); await flush()
  expect(onEscape).not.toHaveBeenCalled()
  expect(hostListener).toHaveBeenCalledTimes(1)
  document.removeEventListener('keydown', hostListener)
})

it('ignores keys other than Escape', () => {
  const onEscape = vi.fn()
  render(<Layer active onEscape={onEscape} />)
  fireEvent.keyDown(document.body, { key: 'Tab' })
  fireEvent.keyDown(document.body, { key: 'Enter' })
  expect(onEscape).not.toHaveBeenCalled()
})

it('ignores Escape pressed while an IME composition is active', () => {
  // 中文输入法里 Esc 是「取消候选」，不能连带关掉弹层、丢掉未保存编辑。
  const onEscape = vi.fn()
  render(<Layer active onEscape={onEscape} />)
  fireEvent.keyDown(document.body, { key: 'Escape', isComposing: true, keyCode: 229 })
  expect(onEscape).not.toHaveBeenCalled()
  // 组合结束后同一个键恢复为关闭。
  esc()
  expect(onEscape).toHaveBeenCalledTimes(1)
})

it('closes the visually top layer even when a lower layer mounts later', () => {
  // 详细用量 1300 先开、通知设置 1200 后开：视觉最上层是 1300。
  const closed: string[] = []
  render(<>
    <Layer active onEscape={() => { closed.push('details') }} zIndex={1300} />
    <Layer active onEscape={() => { closed.push('settings') }} zIndex={1200} />
  </>)
  esc()
  expect(closed).toEqual(['details'])
})

it('treats a host Menu as a host overlay, not only aria-modal dialogs', () => {
  // 宿主 Menu 不是模态标记，但同样把 Esc 挂在 document 上（z-index 1100）。
  const onEscape = vi.fn()
  const hostListener = vi.fn()
  document.addEventListener('keydown', hostListener)
  render(<>
    <Layer active onEscape={onEscape} zIndex={1300} />
    <div role="menu" style={{ position: 'fixed', zIndex: 1100 }} />
  </>)
  esc()
  // 插件在上：只关插件层，宿主菜单不应被同一个按键带走。
  expect(onEscape).toHaveBeenCalledTimes(1)
  expect(hostListener).not.toHaveBeenCalled()
  document.removeEventListener('keydown', hostListener)
})

it('yields to a host Menu that is actually above the plugin layer', () => {
  const onEscape = vi.fn()
  const hostListener = vi.fn()
  document.addEventListener('keydown', hostListener)
  render(<>
    <Layer active onEscape={onEscape} zIndex={1100} />
    <div role="menu" style={{ position: 'fixed', zIndex: 1200 }} />
  </>)
  esc()
  expect(onEscape).not.toHaveBeenCalled()
  expect(hostListener).toHaveBeenCalledTimes(1)
  document.removeEventListener('keydown', hostListener)
})

it('does not mistake the plugin own menu for a host overlay', () => {
  const onEscape = vi.fn()
  const hostListener = vi.fn()
  document.addEventListener('keydown', hostListener)
  render(<>
    <Layer active onEscape={onEscape} zIndex={1100} />
    <div role="menu" data-token-monitor-layer="context-menu" style={{ position: 'fixed', zIndex: 1100 }} />
  </>)
  esc()
  expect(onEscape).toHaveBeenCalledTimes(1)
  document.removeEventListener('keydown', hostListener)
})

/** 真实组件形态的回归：后挂载的详细用量窗口先被关闭。 */
it('closes the later-mounted usage window first when two are open', async () => {
  const closed: string[] = []
  function Window({ id }: { id: string }) {
    const [open, setOpen] = useState(true)
    useEscapeDismiss(open, () => { closed.push(id); setOpen(false) })
    return open ? <div data-window={id} /> : null
  }
  const view = render(<Window id="first" />)
  view.rerender(<><Window id="first" /><Window id="second" /></>)
  esc(); await flush()
  expect(closed).toEqual(['second'])
  expect(document.querySelector('[data-window="first"]')).toBeTruthy()
  esc(); await flush()
  expect(closed).toEqual(['second', 'first'])
  expect(document.querySelector('[data-window="second"]')).toBeNull()
})
