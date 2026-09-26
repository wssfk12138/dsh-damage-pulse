// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ModuleSnapshot } from '@deepseek-ai/dsh-token-monitor-contract'
import { ModuleManagerPanel } from '../src/client/ModuleManagerPanel.tsx'
import { moduleApi } from '../src/client/moduleApi.ts'
import { zh, type DetailTranslate } from '../src/client/detail-locales.ts'

const t: DetailTranslate = (key, values) => Object.entries(values ?? {}).reduce((text, [name, value]) => text.replace(`{${name}}`, String(value)), zh[key] as string)
const snapshot: ModuleSnapshot = { schemaVersion: 1, revision: 7, version: '4.0.3', pluginRemoved: false, restartRequired: false, modules: ['pet', 'overview', 'notify', 'billing', 'wechat'].map(id => ({ id, status: 'installed', autoInstallBlocked: false })) }
afterEach(() => { cleanup(); localStorage.clear() })
function mount(result: ModuleSnapshot = snapshot) {
  const api = { ...moduleApi, uninstall: vi.fn().mockResolvedValue(result), check: vi.fn().mockRejectedValue(new Error('DOWNLOAD_FAILED')) }
  const refresh = vi.fn().mockResolvedValue(undefined), onClose = vi.fn(), onConfigErased = vi.fn()
  render(<ModuleManagerPanel snapshot={snapshot} refresh={refresh} onClose={onClose} onConfigErased={onConfigErased} api={api} t={t} />)
  return { api, refresh, onClose, onConfigErased }
}
it('keeps the whole-plugin capsule last and requests explicit removal with preservation selected', async () => {
  const { api } = mount()
  const capsules = document.querySelectorAll('section')
  expect(capsules).toHaveLength(6)
  expect(capsules[5]?.textContent).toBe('卸载整个插件')
  expect(screen.queryByText('运行中')).toBeNull()
  expect(screen.queryByText('查看日志')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '卸载 桌宠功能区' }))
  expect((screen.getByLabelText('保留配置') as HTMLInputElement).checked).toBe(true)
  expect((screen.getByLabelText('保留历史数据') as HTMLInputElement).checked).toBe(true)
  expect(api.uninstall).not.toHaveBeenCalled()
  fireEvent.click(screen.getByLabelText('计费规则功能区'))
  fireEvent.click(screen.getByRole('button', { name: '卸载' }))
  await waitFor(() => expect(api.uninstall).toHaveBeenCalledWith({ ids: ['pet', 'billing'], wholePlugin: false, preserveData: true, preserveConfig: true, preserveHistory: true, expectedRevision: 7 }))
})
it('clears opted-out browser preferences and reports pending cleanup in a modal', async () => {
  localStorage.setItem('dsh-token-monitor-show-whale-girl', 'false')
  const { onConfigErased, onClose } = mount({ ...snapshot, pluginRemoved: true, cleanupPending: true, cleanupErrors: ['PET_FILE_DELETE_PENDING'] })
  fireEvent.click(screen.getByRole('button', { name: '卸载 桌宠功能区' }))
  fireEvent.click(screen.getByLabelText('保留配置'))
  fireEvent.click(screen.getByRole('button', { name: '卸载' }))
  expect((await screen.findByRole('alert')).textContent).toContain('PET_FILE_DELETE_PENDING')
  expect(localStorage.getItem('dsh-token-monitor-show-whale-girl')).toBeNull()
  expect(onConfigErased).toHaveBeenCalledWith(['pet'])
  expect(onClose).not.toHaveBeenCalled()
})
it('shows update failures only in the dismissible error dialog', async () => {
  mount()
  fireEvent.click(screen.getByRole('button', { name: '检查更新' }))
  expect((await screen.findByRole('alert')).textContent).toContain('DOWNLOAD_FAILED')
  const alert = screen.getByRole('alert')
  fireEvent.click(alert.parentElement!.querySelector('button')!)
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
  expect(screen.queryByText(/DOWNLOAD_FAILED/)).toBeNull()
})

it('keeps manager controls outside the draggable balance-card pointer path', () => {
  const parentPointerDown = vi.fn()
  const onClose = vi.fn()
  const api = { ...moduleApi, check: vi.fn().mockResolvedValue({ currentVersion: '4.0.3', latestVersion: '4.0.3', hasUpdate: false, compatible: true }) }
  render(
    <div onPointerDown={parentPointerDown}>
      <ModuleManagerPanel snapshot={snapshot} refresh={vi.fn().mockResolvedValue(undefined)} onClose={onClose} api={api} t={t} />
    </div>,
  )
  fireEvent.pointerDown(screen.getByRole('button', { name: '关闭' }))
  fireEvent.click(screen.getByRole('button', { name: '关闭' }))
  expect(parentPointerDown).not.toHaveBeenCalled()
  expect(onClose).toHaveBeenCalledTimes(1)
})
