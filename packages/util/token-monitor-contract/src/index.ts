/**
 * Browser-safe wire contract for DSH Token Monitor settings.
 * This package deliberately has no Host, React, Cordis, or Node dependency.
 * @module @deepseek-ai/dsh-token-monitor-contract
 */

export const TOKEN_MONITOR_SETTINGS_SCHEMA_VERSION = 3 as const
export { validateBillingRules, validateBillingApplied, normalizeMultiplier, emptyBillingRule } from './billing.ts'
export type { BillingRules, BillingModelRule, BillingPrice, BillingPeriod, BillingTier, BillingSnapshot, BillingSource, BillingApplied } from './billing.ts'
/** Maximum accepted byte length of a settings request body. */
export const TOKEN_MONITOR_SETTINGS_MAX_BODY_BYTES = 16 * 1024
/** Maximum daily budget accepted by Token Monitor settings validation. */
export const TOKEN_MONITOR_MAX_DAILY_BUDGET_CNY = 1_000_000

/** Metric displayed in the compact Token Monitor widget. */
export type TokenMonitorDisplayMode = 'balance' | 'spend'

/** Stable user-editable settings. Runtime connection state is not persisted here. */
export interface TokenMonitorSettings {
  displayMode: TokenMonitorDisplayMode
  showWhaleGirl: boolean
  dailyBudgetEnabled: boolean
  dailyBudgetCny: number
  budgetExceededNotificationEnabled: boolean
  peakReminderEnabled: boolean
  peakReminderEnterPeak: boolean
  peakReminderEnterValley: boolean
  notifyOncePerTransition: boolean
  whaleBubbleEnabled: boolean
  wechatNotificationsEnabled: boolean
  /** Emit a notification when the aggregate cache hit rate stays below threshold. */
  cacheHitAnomalyNotificationEnabled: boolean
  /** Percentage in the inclusive 0..100 range. */
  cacheHitAnomalyThreshold: number
  /** Number of consecutive valid calls in the rolling sample. */
  cacheHitAnomalyConsecutiveCalls: number
}

/** Partial update accepted for persisted Token Monitor settings. */
export type TokenMonitorSettingsPatch = Partial<TokenMonitorSettings>

/** Versioned settings state returned by the Host endpoint. */
export interface TokenMonitorSettingsSnapshot {
  schemaVersion: typeof TOKEN_MONITOR_SETTINGS_SCHEMA_VERSION
  revision: number
  settings: TokenMonitorSettings
}

/** Optimistic-concurrency envelope for a settings update. */
export interface TokenMonitorSettingsPatchRequest {
  expectedRevision?: number
  patch: TokenMonitorSettingsPatch
}

/** Stable error codes returned by the settings endpoint. */
export type TokenMonitorSettingsErrorCode =
  | 'METHOD_NOT_ALLOWED'
  | 'INVALID_JSON'
  | 'PAYLOAD_TOO_LARGE'
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'VALIDATION_ERROR'
  | 'CONFLICT'
  | 'WRITE_FAILED'

/** Structured error response returned by the settings endpoint. */
export interface TokenMonitorSettingsErrorResponse {
  error: {
    code: TokenMonitorSettingsErrorCode
    message: string
    details?: { fields?: Record<string, string> }
  }
}

/** Success or field-indexed validation failure returned by wire parsers. */
export type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; fields: Record<string, string> }

/** Default values applied when no persisted Token Monitor settings exist. */
export const DEFAULT_TOKEN_MONITOR_SETTINGS: Readonly<TokenMonitorSettings> = Object.freeze({
  displayMode: 'balance',
  showWhaleGirl: true,
  dailyBudgetEnabled: true,
  dailyBudgetCny: 10,
  budgetExceededNotificationEnabled: false,
  peakReminderEnabled: true,
  peakReminderEnterPeak: true,
  peakReminderEnterValley: true,
  notifyOncePerTransition: false,
  whaleBubbleEnabled: true,
  wechatNotificationsEnabled: true,
  cacheHitAnomalyNotificationEnabled: false,
  cacheHitAnomalyThreshold: 30,
  cacheHitAnomalyConsecutiveCalls: 3,
})

/** Persisted public keys accepted in Token Monitor settings. */
export const TOKEN_MONITOR_SETTING_KEYS = Object.freeze([
  'displayMode',
  'showWhaleGirl',
  'dailyBudgetEnabled',
  'dailyBudgetCny',
  'budgetExceededNotificationEnabled',
  'peakReminderEnabled',
  'peakReminderEnterPeak',
  'peakReminderEnterValley',
  'notifyOncePerTransition',
  'whaleBubbleEnabled',
  'wechatNotificationsEnabled',
  'cacheHitAnomalyNotificationEnabled',
  'cacheHitAnomalyThreshold',
  'cacheHitAnomalyConsecutiveCalls',
] as const satisfies readonly (keyof TokenMonitorSettings)[])

const BOOLEAN_KEYS = new Set<keyof TokenMonitorSettings>([
  'showWhaleGirl',
  'dailyBudgetEnabled',
  'budgetExceededNotificationEnabled',
  'peakReminderEnabled',
  'peakReminderEnterPeak',
  'peakReminderEnterValley',
  'notifyOncePerTransition',
  'whaleBubbleEnabled',
  'wechatNotificationsEnabled',
  'cacheHitAnomalyNotificationEnabled',
])
const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype: unknown = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function hasAtMostTwoDecimalPlaces(value: number): boolean {
  const rounded = Math.round(value * 100) / 100
  return Math.abs(value - rounded) <= 1e-9
}

function validateSettingValue(key: keyof TokenMonitorSettings, value: unknown): string | undefined {
  if (BOOLEAN_KEYS.has(key)) return typeof value === 'boolean' ? undefined : '必须是布尔值'
  if (key === 'displayMode') return value === 'balance' || value === 'spend'
    ? undefined
    : '只能是 balance 或 spend'
  if (key === 'dailyBudgetCny') {
    if (typeof value !== 'number' || !Number.isFinite(value)) return '必须是有限数字'
    if (value <= 0 || value > TOKEN_MONITOR_MAX_DAILY_BUDGET_CNY) {
      return `必须大于 0 且不超过 ${String(TOKEN_MONITOR_MAX_DAILY_BUDGET_CNY)}`
    }
    if (!hasAtMostTwoDecimalPlaces(value)) return '最多保留两位小数'
  }
  if (key === 'cacheHitAnomalyThreshold') {
    if (typeof value !== 'number' || !Number.isSafeInteger(value)) return '必须是 0 到 100 的整数百分比'
    if (value < 0 || value > 100) return '必须在 0 到 100 之间'
  }
  if (key === 'cacheHitAnomalyConsecutiveCalls') {
    if (typeof value !== 'number' || !Number.isSafeInteger(value)) return '必须是 2 到 20 的整数'
    if (value < 2 || value > 20) return '必须在 2 到 20 之间'
  }
  return undefined
}

function parseSettingsObject(
  value: unknown,
  partial: boolean,
  prefix: string,
): ParseResult<TokenMonitorSettings | TokenMonitorSettingsPatch> {
  if (!isPlainObject(value)) return { ok: false, fields: { [prefix]: '必须是普通对象' } }
  const fields: Record<string, string> = {}
  const output: Record<string, unknown> = {}
  const allowed = new Set<string>(TOKEN_MONITOR_SETTING_KEYS)
  for (const key of Object.keys(value)) {
    const path = `${prefix}.${key}`
    if (DANGEROUS_KEYS.has(key)) {
      fields[path] = '禁止使用危险对象键'
      continue
    }
    if (!allowed.has(key)) {
      fields[path] = '未知设置字段'
      continue
    }
    const typedKey = key as keyof TokenMonitorSettings
    const error = validateSettingValue(typedKey, value[key])
    if (error !== undefined) fields[path] = error
    else output[key] = value[key]
  }
  if (!partial) {
    for (const key of TOKEN_MONITOR_SETTING_KEYS) {
      if (!(key in value)) fields[`${prefix}.${key}`] = '缺少必填字段'
    }
  }
  return Object.keys(fields).length > 0
    ? { ok: false, fields }
    : { ok: true, value: output as TokenMonitorSettings | TokenMonitorSettingsPatch }
}

/**
 * Validate and detach a complete public settings object.
 * @param value - Untrusted value to validate or format.
 * @returns A detached settings object or field-indexed validation errors.
 */
export function parseTokenMonitorSettings(value: unknown): ParseResult<TokenMonitorSettings> {
  const result = parseSettingsObject(value, false, 'settings')
  return result.ok ? { ok: true, value: result.value as TokenMonitorSettings } : result
}

/**
 * Validate and detach the PATCH wire envelope, rejecting unknown and dangerous keys.
 * @param value - Untrusted value to validate or format.
 * @returns A detached patch request or field-indexed validation errors.
 */
export function parseTokenMonitorSettingsPatchRequest(value: unknown): ParseResult<TokenMonitorSettingsPatchRequest> {
  if (!isPlainObject(value)) return { ok: false, fields: { body: '必须是普通对象' } }
  const fields: Record<string, string> = {}
  for (const key of Object.keys(value)) {
    if (DANGEROUS_KEYS.has(key)) fields[key] = '禁止使用危险对象键'
    else if (key !== 'patch' && key !== 'expectedRevision') fields[key] = '未知请求字段'
  }
  if (!Object.hasOwn(value, 'patch')) fields.patch = '缺少必填字段'
  const parsedPatch = parseSettingsObject(value.patch, true, 'patch')
  if (!parsedPatch.ok) Object.assign(fields, parsedPatch.fields)
  const expectedRevision = value.expectedRevision
  if (expectedRevision !== undefined
    && (typeof expectedRevision !== 'number' || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0)) {
    fields.expectedRevision = '必须是非负安全整数'
  }
  if (Object.keys(fields).length > 0) return { ok: false, fields }
  const validExpectedRevision = expectedRevision as number | undefined
  return {
    ok: true,
    value: {
      ...(validExpectedRevision === undefined ? {} : { expectedRevision: validExpectedRevision }),
      patch: parsedPatch.ok ? parsedPatch.value as TokenMonitorSettingsPatch : {},
    },
  }
}

/**
 * Validate a successful GET/PATCH response before Client code trusts it.
 * @param value - Untrusted value to validate or format.
 * @returns A detached settings snapshot or field-indexed validation errors.
 */
export function parseTokenMonitorSettingsSnapshot(value: unknown): ParseResult<TokenMonitorSettingsSnapshot> {
  if (!isPlainObject(value)) return { ok: false, fields: { response: '必须是普通对象' } }
  const fields: Record<string, string> = {}
  for (const key of Object.keys(value)) {
    if (key !== 'schemaVersion' && key !== 'revision' && key !== 'settings') fields[key] = '未知响应字段'
  }
  if (value.schemaVersion !== TOKEN_MONITOR_SETTINGS_SCHEMA_VERSION) fields.schemaVersion = '不支持的 schemaVersion'
  if (typeof value.revision !== 'number' || !Number.isSafeInteger(value.revision) || value.revision < 0) {
    fields.revision = '必须是非负安全整数'
  }
  const parsedSettings = parseTokenMonitorSettings(value.settings)
  if (!parsedSettings.ok) Object.assign(fields, parsedSettings.fields)
  if (Object.keys(fields).length > 0) return { ok: false, fields }
  return {
    ok: true,
    value: {
      schemaVersion: TOKEN_MONITOR_SETTINGS_SCHEMA_VERSION,
      revision: value.revision as number,
      settings: parsedSettings.ok ? parsedSettings.value : { ...DEFAULT_TOKEN_MONITOR_SETTINGS },
    },
  }
}

/**
 * Pick only public fields from a resolved Host settings section.
 * @param value - Untrusted value to validate or format.
 * @returns A validated copy containing only public settings fields.
 */
export function pickPublicTokenMonitorSettings(value: Record<string, unknown>): TokenMonitorSettings {
  const picked: Record<string, unknown> = {}
  for (const key of TOKEN_MONITOR_SETTING_KEYS) picked[key] = value[key]
  const parsed = parseTokenMonitorSettings(picked)
  if (!parsed.ok) throw new TypeError(`invalid resolved token monitor settings: ${JSON.stringify(parsed.fields)}`)
  return parsed.value
}

/** Error raised when persisted settings use a newer schema version. */
export class UnsupportedTokenMonitorSettingsVersionError extends Error {
  constructor(readonly version: number) {
    super(`token monitor settings schema version ${String(version)} is newer than supported version ${String(TOKEN_MONITOR_SETTINGS_SCHEMA_VERSION)}`)
    this.name = 'UnsupportedTokenMonitorSettingsVersionError'
  }
}

/**
 * Decide whether an existing raw user section needs the legacy v0 to v1 migration.
 * @param user - Raw persisted user settings section.
 * @returns The required legacy migration patch, or undefined when no migration is needed.
 */
export function planTokenMonitorSettingsMigration(
  user: unknown,
): { schemaVersion: 3; budgetExceededNotificationEnabled: false; cacheHitAnomalyNotificationEnabled: false } | undefined {
  if (user === undefined) return undefined
  if (!isPlainObject(user)) throw new TypeError('token monitor settings user section must be a plain object')
  const version = user.schemaVersion
  if (version === undefined || version === 0 || version === 1 || version === 2) {
    return {
      schemaVersion: TOKEN_MONITOR_SETTINGS_SCHEMA_VERSION,
      budgetExceededNotificationEnabled: false,
      cacheHitAnomalyNotificationEnabled: false,
    }
  }
  if (typeof version !== 'number' || !Number.isSafeInteger(version) || version < 0) {
    throw new TypeError('token monitor settings schemaVersion must be a non-negative safe integer')
  }
  if (version > TOKEN_MONITOR_SETTINGS_SCHEMA_VERSION) throw new UnsupportedTokenMonitorSettingsVersionError(version)
  return undefined
}

/** Terminal status recorded for one provider attempt. */
export type DetailStatus = 'success' | 'error' | 'cancelled'
/** Display-only session metadata; parent is set only for an explicit subagent. */
export interface DetailSession { id: string; title: string; project: string; child: boolean; parent?: string | undefined }
/** One provider attempt. Missing telemetry remains unknown for old records. */
export interface DetailRow {
  feeExplanation?: {
    rule?: import('./billing.ts').BillingModelRule
    applied?: import('./billing.ts').BillingApplied
    reason?: string
    costInput: number
    costCacheRead?: number
    costCacheWrite?: number
    costOutput: number
  }
  billingStatus?: 'priced' | 'unpriced' | 'disabled' | undefined
  billingRuleVersion?: number | undefined
  modelMultiplier?: number | undefined
  reasoningTokens?: number | undefined
  /** Resolved request setting captured when this attempt started; absent for legacy telemetry. */
  reasoningEffort?: string | undefined
  id: string
  sessionId: string
  sourceEventSeq?: number | undefined
  timestamp: number
  provider: string
  model: string
  status: DetailStatus
  startedAt?: number | undefined
  endedAt?: number | undefined
  firstMs?: number | undefined
  totalMs?: number | undefined
  inputTokens?: number | undefined
  outputTokens?: number | undefined
  cacheReadTokens?: number | undefined
  cacheWriteTokens?: number | undefined
  cost?: number | undefined
  peak?: boolean | undefined
  errorType?: string | undefined
  httpStatus?: number | undefined
}
/** Paginated usage-detail response together with its filter metadata. */
export interface DetailPage {
  snapshot: string
  capturedAt: number
  rows: DetailRow[]
  total: number
  page: number
  pages: number
  size: number
  sessions: DetailSession[]
  models: string[]
  providers?: string[]
}
export * from './modules.ts'
