/**
 * Browser-safe wire contract for DSH Token Monitor settings.
 * This package deliberately has no Host, React, Cordis, or Node dependency.
 * @module @deepseek-ai/dsh-token-monitor-contract
 */

export const TOKEN_MONITOR_SETTINGS_SCHEMA_VERSION = 3 as const
export const TOKEN_MONITOR_SETTINGS_MAX_BODY_BYTES = 16 * 1024
export const TOKEN_MONITOR_MAX_DAILY_BUDGET_CNY = 1_000_000
/** Upper bound for the balance health-bar ceiling; the bar is a ratio against it. */
export const TOKEN_MONITOR_MIN_HEALTH_BAR_CNY = 0.01
export const TOKEN_MONITOR_MAX_HEALTH_BAR_CNY = 1_000_000

export type TokenMonitorDisplayMode = 'balance' | 'spend'

/**
 * Health-bar palette presets. The wire carries only the id; the Client owns the
 * concrete gradient, so retuning a palette never needs a settings migration.
 */
export const TOKEN_MONITOR_HEALTH_BAR_COLORS = ['red', 'green', 'blue', 'amber', 'violet', 'cyan', 'rose'] as const
export type TokenMonitorHealthBarColor = (typeof TOKEN_MONITOR_HEALTH_BAR_COLORS)[number]

/**
 * 扣血特效强度档位。`off` 关掉抖动/冲击环/火花/闪白，但保留飘字与血条扣减——
 * 那些是信息而不是特效。档位到具体倍率的映射由 Client 拥有。
 */
export const TOKEN_MONITOR_DAMAGE_EFFECT_LEVELS = ['off', 'subtle', 'normal', 'strong', 'extreme'] as const
export type TokenMonitorDamageEffectLevel = (typeof TOKEN_MONITOR_DAMAGE_EFFECT_LEVELS)[number]

/** Stable user-editable settings. Runtime connection state is not persisted here. */
export interface TokenMonitorSettings {
  displayMode: TokenMonitorDisplayMode
  /**
   * Balance that fills the card's health bar completely. The bar drains as the
   * account is spent, so this is the "full HP" reference, not a spending limit.
   */
  healthBarMaxCny: number
  /** Palette preset for the health bar and its hit effects. */
  healthBarColor: TokenMonitorHealthBarColor
  /** How large the per-charge hit effects are drawn. */
  damageEffectLevel: TokenMonitorDamageEffectLevel
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

export type TokenMonitorSettingsPatch = Partial<TokenMonitorSettings>

export interface TokenMonitorSettingsSnapshot {
  schemaVersion: typeof TOKEN_MONITOR_SETTINGS_SCHEMA_VERSION
  revision: number
  settings: TokenMonitorSettings
}

export interface TokenMonitorSettingsPatchRequest {
  expectedRevision?: number
  patch: TokenMonitorSettingsPatch
}

export type TokenMonitorSettingsErrorCode =
  | 'METHOD_NOT_ALLOWED'
  | 'INVALID_JSON'
  | 'PAYLOAD_TOO_LARGE'
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'VALIDATION_ERROR'
  | 'CONFLICT'
  | 'WRITE_FAILED'

export interface TokenMonitorSettingsErrorResponse {
  error: {
    code: TokenMonitorSettingsErrorCode
    message: string
    details?: { fields?: Record<string, string> }
  }
}

export type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; fields: Record<string, string> }

export const DEFAULT_TOKEN_MONITOR_SETTINGS: Readonly<TokenMonitorSettings> = Object.freeze({
  displayMode: 'balance',
  healthBarMaxCny: 100,
  healthBarColor: 'red',
  damageEffectLevel: 'normal',
  showWhaleGirl: true,
  dailyBudgetEnabled: true,
  dailyBudgetCny: 10,
  budgetExceededNotificationEnabled: false,
  peakReminderEnabled: false,
  peakReminderEnterPeak: false,
  peakReminderEnterValley: false,
  notifyOncePerTransition: false,
  whaleBubbleEnabled: false,
  wechatNotificationsEnabled: false,
  cacheHitAnomalyNotificationEnabled: false,
  cacheHitAnomalyThreshold: 30,
  cacheHitAnomalyConsecutiveCalls: 3,
})

export const TOKEN_MONITOR_SETTING_KEYS = Object.freeze([
  'displayMode',
  'healthBarMaxCny',
  'healthBarColor',
  'damageEffectLevel',
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

// 非通知的功能性开关：默认开启，不参与「通知默认关闭」策略。
export const DEFAULT_TRUE_BOOLEAN_KEYS = Object.freeze(['showWhaleGirl', 'dailyBudgetEnabled'] as const)

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
  if (key === 'healthBarMaxCny') {
    if (typeof value !== 'number' || !Number.isFinite(value)) return '必须是有限数字'
    if (value < TOKEN_MONITOR_MIN_HEALTH_BAR_CNY || value > TOKEN_MONITOR_MAX_HEALTH_BAR_CNY) {
      return `必须在 ${String(TOKEN_MONITOR_MIN_HEALTH_BAR_CNY)} 到 ${String(TOKEN_MONITOR_MAX_HEALTH_BAR_CNY)} 之间`
    }
    if (!hasAtMostTwoDecimalPlaces(value)) return '最多保留两位小数'
  }
  if (key === 'healthBarColor') {
    // 只接受预设 id：具体渐变在 Client，wire 上不接受任意颜色字符串。
    return typeof value === 'string' && (TOKEN_MONITOR_HEALTH_BAR_COLORS as readonly string[]).includes(value)
      ? undefined
      : `只能是 ${TOKEN_MONITOR_HEALTH_BAR_COLORS.join('、')} 之一`
  }
  if (key === 'damageEffectLevel') {
    return typeof value === 'string' && (TOKEN_MONITOR_DAMAGE_EFFECT_LEVELS as readonly string[]).includes(value)
      ? undefined
      : `只能是 ${TOKEN_MONITOR_DAMAGE_EFFECT_LEVELS.join('、')} 之一`
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

function parseSettingsObject(value: unknown, partial: boolean, prefix: string): ParseResult<TokenMonitorSettings | TokenMonitorSettingsPatch> {
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

/** Validate and detach a complete public settings object. */
export function parseTokenMonitorSettings(value: unknown): ParseResult<TokenMonitorSettings> {
  const result = parseSettingsObject(value, false, 'settings')
  return result.ok ? { ok: true, value: result.value as TokenMonitorSettings } : result
}

/** Validate and detach the PATCH wire envelope, rejecting unknown and dangerous keys. */
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

/** Validate a successful GET/PATCH response before Client code trusts it. */
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

/** Pick only public fields from a resolved Host settings section. */
export function pickPublicTokenMonitorSettings(value: Record<string, unknown>): TokenMonitorSettings {
  const picked: Record<string, unknown> = {}
  for (const key of TOKEN_MONITOR_SETTING_KEYS) picked[key] = value[key]
  const parsed = parseTokenMonitorSettings(picked)
  if (!parsed.ok) throw new TypeError(`invalid resolved token monitor settings: ${JSON.stringify(parsed.fields)}`)
  return parsed.value
}

export class UnsupportedTokenMonitorSettingsVersionError extends Error {
  constructor(readonly version: number) {
    super(`token monitor settings schema version ${String(version)} is newer than supported version ${String(TOKEN_MONITOR_SETTINGS_SCHEMA_VERSION)}`)
    this.name = 'UnsupportedTokenMonitorSettingsVersionError'
  }
}

const NOTIFICATION_DEFAULT_OFF_KEYS = [
  'budgetExceededNotificationEnabled',
  'peakReminderEnabled',
  'peakReminderEnterPeak',
  'peakReminderEnterValley',
  'notifyOncePerTransition',
  'whaleBubbleEnabled',
  'wechatNotificationsEnabled',
  'cacheHitAnomalyNotificationEnabled',
] as const satisfies readonly (keyof TokenMonitorSettings)[]

type TokenMonitorSettingsMigration = Partial<TokenMonitorSettings> & { schemaVersion?: typeof TOKEN_MONITOR_SETTINGS_SCHEMA_VERSION }

/** Persist conservative notification defaults for legacy and incomplete current settings. */
export function planTokenMonitorSettingsMigration(user: unknown): TokenMonitorSettingsMigration | undefined {
  if (user === undefined) return undefined
  if (!isPlainObject(user)) throw new TypeError('token monitor settings user section must be a plain object')
  const version = user.schemaVersion
  if (version !== undefined && (typeof version !== 'number' || !Number.isSafeInteger(version) || version < 0)) {
    throw new TypeError('token monitor settings schemaVersion must be a non-negative safe integer')
  }
  if (typeof version === 'number' && version > TOKEN_MONITOR_SETTINGS_SCHEMA_VERSION) {
    throw new UnsupportedTokenMonitorSettingsVersionError(version)
  }
  const patch: TokenMonitorSettingsMigration = {}
  if (version !== TOKEN_MONITOR_SETTINGS_SCHEMA_VERSION) patch.schemaVersion = TOKEN_MONITOR_SETTINGS_SCHEMA_VERSION
  for (const key of NOTIFICATION_DEFAULT_OFF_KEYS) {
    if (!Object.hasOwn(user, key)) patch[key] = false
  }
  return Object.keys(patch).length === 0 ? undefined : patch
}
