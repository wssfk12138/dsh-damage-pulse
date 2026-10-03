import type { Translate } from '@deepseek-ai/dsh-client-ui-slots'
import { billingEn, billingZh } from './billing-locales.ts'
import { moduleEn, moduleZh } from './module-locales.ts'

/** Chinese copy for usage details and billing controls. */
export const zh = {
  ...billingZh,
  ...moduleZh,
  overviewTitle: '数据概览', overviewRefresh: '刷新概览', overviewExpand: '展开概览', overviewCollapse: '收起概览', overviewRange: '概览时间范围',
  overviewCustom: '自定义：{from} ~ {to}',
  overviewScope: '与下方明细共用时间与供应商筛选 · 北京时间',
  overviewSpend: '消费', overviewRequests: '请求数', overviewTokens: 'Token 总数', overviewDays: '活跃天数', overviewCache: '缓存命中 Token', overviewHitRate: '缓存命中率',
  overviewPer100m: '每亿 Token 费用', overviewDaily: '活跃日均消费', overviewDayUnit: '天', overviewPercent: '%', overviewPer100mUnit: '元/亿', overviewDailyUnit: '元/天',
  overviewPer100mHint: '所选时段总消费 ÷ 同期 Token 总数 × 一亿；无 Token 时显示 —。',
  overviewDailyHint: '所选时段总消费 ÷ 有合格用量记录的活跃天数；无活跃日时显示 —。',
  columns: '列设置', restoreColumns: '恢复默认列', provider: 'Provider', reasoningTokens: '推理 Token', reasoningEffort: '推理强度',
  title: '详细用量', usage: '用量明细', errors: '错误请求', close: '关闭', maximize: '最大化', restore: '还原', unpriced: '未计价', disabled: '已关闭',
  from: '开始时间', to: '结束时间', all: '可用历史', '30d': '30天', '7d': '7天', yesterday: '昨日', today: '今日', allProviders: '全部供应商',
  model: '模型', project: '项目', session: '对话', allModels: '全部模型', allProjects: '全部项目', allSessions: '全部对话',
  refresh: '刷新', reset: '重置筛选', apply: '应用时间', child: '子代理', tokens: 'Token', fee: '本地费用', latency: '延迟', time: '记录时间',
  resetConfirm: '确认重置筛选条件？将恢复为今日、全部模型、全部项目和全部对话，并返回用量明细第一页。不会删除任何用量记录。',
  input: '未缓存输入', output: '输出（已包含推理）', cache: '缓存命中', first: '首字', total: '总耗时', unknown: '未记录',
  peak: '峰', valley: '谷', loading: '正在加载…', empty: '当前筛选没有记录', failed: '加载失败，请重试', expired: '此页快照已过期，请刷新',
  authorizationExpired: '授权异常，自动刷新已暂停，请重新认证后刷新', staleData: '保留上次成功数据，当前值可能已过期',
  historicalSnapshot: '历史快照：明细与阅读位置保持不变；概览仍自动更新，可能有新数据，刷新可查看最新第一页',
  invalidTime: '请填写有效的起止时间，结束时间不能早于开始时间', cancelled: '包含已取消请求', cancelledStatus: '已取消',
  errorType: '错误类型', allErrors: '全部错误', rate_limit: '请求限流', authentication: '认证失败', server: '服务端错误',
  timeout: '超时', network: '网络错误', errorUnknown: '未知错误', errorDetail: '错误详情', errorSafe: '仅保留错误分类和 HTTP 状态，不保存请求内容或凭据。',
  status: '状态', http: 'HTTP 状态', prev: '上一页', next: '下一页', pageSize: '每页条数', pages: '第 {page} / {pages} 页 · 共 {count} 条',
  pageUnavailable: '第 {page} 页 · 总页数与条数暂不可用',
  scope: '包含子代理 · 北京时间', duration: '{value} s', captured: '快照时间：{time}',
  resize: '调整窗口大小', started: '请求开始', ended: '请求结束', missingProject: '未记录项目',
  n: '上边', s: '下边', e: '右边', w: '左边', ne: '右上角', nw: '左上角', se: '右下角', sw: '左下角',
  showFilters: '展开筛选', hideFilters: '收起筛选', requestInfo: '请求信息',
  timingHint: '首字：≤5秒绿、≤15秒黄、其余红；总耗时：≤60秒绿、≤180秒黄、其余红。首字包括推理、正文或工具输出。',
  errorHistory: '错误记录从此功能启用后开始采集；旧记录缺失的延迟显示“未记录”。',
} as const
/** Locale keys shared by usage details and billing controls. */
export type DetailKey = keyof typeof zh
/** Typed translator accepted by usage and billing components. */
export type DetailTranslate = Translate<DetailKey>
/** English copy for usage details and billing controls. */
export const en: Record<DetailKey, string> = {
  ...billingEn,
  ...moduleEn,
  overviewTitle: 'Usage overview', overviewRefresh: 'Refresh overview', overviewExpand: 'Expand overview', overviewCollapse: 'Collapse overview', overviewRange: 'Overview time range',
  overviewCustom: 'Custom: {from} — {to}',
  overviewScope: 'Shares time and provider filters with the list below · Beijing time',
  overviewSpend: 'Spend', overviewRequests: 'Requests', overviewTokens: 'Total tokens', overviewDays: 'Active days', overviewCache: 'Cache-hit tokens', overviewHitRate: 'Cache hit rate',
  overviewPer100m: 'Cost per 100M tokens', overviewDaily: 'Spend per active day', overviewDayUnit: 'days', overviewPercent: '%', overviewPer100mUnit: 'CNY/100M', overviewDailyUnit: 'CNY/day',
  overviewPer100mHint: 'Selected-period spend ÷ tokens in the same period × 100 million. No tokens: —.',
  overviewDailyHint: 'Selected-period spend ÷ days with eligible usage records. No active days: —.',
  columns: 'Columns', restoreColumns: 'Restore default columns', provider: 'Provider', reasoningTokens: 'Reasoning tokens', reasoningEffort: 'Reasoning effort',
  title: 'Detailed usage', usage: 'Usage', errors: 'Failed requests', close: 'Close', maximize: 'Maximize', restore: 'Restore', unpriced: 'Unpriced', disabled: 'Billing off',
  from: 'Start', to: 'End', all: 'Available history', '30d': '30 days', '7d': '7 days', yesterday: 'Yesterday', today: 'Today', allProviders: 'All providers',
  model: 'Model', project: 'Project', session: 'Conversation', allModels: 'All models', allProjects: 'All projects', allSessions: 'All conversations',
  refresh: 'Refresh', reset: 'Reset filters', apply: 'Apply dates', child: 'Subagent', tokens: 'Token', fee: 'Local cost', latency: 'Latency', time: 'Recorded at',
  resetConfirm: 'Reset filters to today, all models, all projects and all conversations, and return to the first usage page? No usage records will be deleted.',
  input: 'Uncached input', output: 'Output (including reasoning)', cache: 'Cache hit', first: 'First token', total: 'Total', unknown: 'Not recorded',
  peak: 'Peak', valley: 'Off-peak', loading: 'Loading…', empty: 'No matching records', failed: 'Could not load. Please retry.', expired: 'This snapshot expired. Please refresh.',
  authorizationExpired: 'Authorization failed. Auto-refresh paused. Authenticate again, then refresh.', staleData: 'Last successful data retained; values may be stale.',
  historicalSnapshot: 'Historical snapshot: rows and reading position stay fixed. Overview still updates; new data may be available. Refresh to see the latest first page.',
  invalidTime: 'Enter valid dates with the end after the start.', cancelled: 'Include cancelled requests', cancelledStatus: 'Cancelled',
  errorType: 'Error type', allErrors: 'All errors', rate_limit: 'Rate limited', authentication: 'Authentication', server: 'Server error',
  timeout: 'Timeout', network: 'Network error', errorUnknown: 'Unknown error', errorDetail: 'Error details', errorSafe: 'Only classification and HTTP status are retained. Request content and credentials are not stored.',
  status: 'Status', http: 'HTTP status', prev: 'Previous', next: 'Next', pageSize: 'Rows per page', pages: 'Page {page} / {pages} · {count} rows',
  pageUnavailable: 'Page {page} · Total pages and rows currently unavailable',
  scope: 'Includes subagents · Beijing time', duration: '{value} s', captured: 'Snapshot: {time}',
  resize: 'Resize window', started: 'Request start', ended: 'Request end', missingProject: 'Project not recorded',
  n: 'Top', s: 'Bottom', e: 'Right', w: 'Left', ne: 'Top right', nw: 'Top left', se: 'Bottom right', sw: 'Bottom left',
  showFilters: 'Show filters', hideFilters: 'Hide filters', requestInfo: 'Request information',
  timingHint: 'First token: green ≤5s, amber ≤15s, otherwise red. Total: green ≤60s, amber ≤180s, otherwise red. First token includes reasoning, text or tool output.',
  errorHistory: 'Failure collection begins when this feature is enabled. Missing historical latency is shown as not recorded.',
}
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { 'token-monitor.details': DetailKey }
}
