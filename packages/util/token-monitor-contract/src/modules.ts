/** Stable module identifiers are permanent: removed identifiers must never be reused. */
export const TOKEN_MONITOR_MODULE_IDS = ['pet', 'overview', 'notify', 'billing', 'wechat'] as const
export type TokenMonitorModuleId = typeof TOKEN_MONITOR_MODULE_IDS[number]
export type ModuleInstallationStatus = 'installed' | 'removed' | 'pending-delete' | 'unavailable'
export interface ModuleInstallation {
  id: string
  status: ModuleInstallationStatus
  autoInstallBlocked: boolean
}
/** Core and every installed module have exactly this one release version. */
export interface ModuleSnapshot {
  schemaVersion: 1
  revision: number
  version: string
  pluginRemoved: boolean
  restartRequired: boolean
  modules: ModuleInstallation[]
  /** Whole-plugin removal retains management only while cleanup needs retrying. */
  cleanupPending?: boolean
  /** Safe operation codes only; never raw filesystem paths or user settings. */
  cleanupErrors?: string[]
}
export interface ModuleUninstallRequest {
  ids: string[]
  preserveData: boolean
  preserveConfig?: boolean
  preserveHistory?: boolean
  expectedRevision: number
  wholePlugin?: boolean
}
export interface ModuleUpdateStatus {
  currentVersion: string
  latestVersion: string
  hasUpdate: boolean
  compatible: boolean
}
export interface ModuleRestorePlan {
  id: string
  currentVersion: string
  latestVersion: string
  currentAvailable: boolean
  hasUpdate: boolean
}
export interface ModuleRestoreRequest {
  id: string
  upgrade: boolean
  expectedRevision: number
}
/** A release manifest contains files only, never commands or user-selectable paths. */
export interface ModuleArtifact {
  root: 'host' | 'client' | 'assets'
  path: string
  sha256: string
  size: number
}
export interface ModuleReleaseManifest {
  schemaVersion: 1
  version: string
  core: ModuleArtifact[]
  modules: Array<{ id: string; files: ModuleArtifact[] }>
}
