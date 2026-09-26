import type { WechatNotifyResult } from '../../wechat-notify/src/sender.ts'
import {
  PeakTransitionScheduler,
  type PeakTransition,
  type PeakTransitionClock,
} from './peak-transition.ts'

export interface PeakReminderSender {
  send(message: string): Promise<WechatNotifyResult>
}

export interface PeakReminderContext {
  effect(callback: () => () => void | Promise<void>, label?: string): unknown
}

export interface PeakReminderOptions {
  clock?: PeakTransitionClock
  warn?: (message: string) => void
  settings?: () => PeakReminderSettings
  onTransition?: (transition: PeakTransition) => void
}

export interface PeakReminderSettings {
  peakReminderEnabled: boolean
  peakReminderEnterPeak: boolean
  peakReminderEnterValley: boolean
}

const DEFAULT_PEAK_REMINDER_SETTINGS: Readonly<PeakReminderSettings> = Object.freeze({
  peakReminderEnabled: false,
  peakReminderEnterPeak: false,
  peakReminderEnterValley: false,
})

/** Fixed user-facing message for a genuine effective-period transition. */
export function formatPeakTransitionMessage(transition: PeakTransition): string {
  const schedule = [
    '工作日峰时段：09:00–12:00、14:00–18:00',
    '其余工作日时段及周末全天为谷时段。',
  ]
  if (transition.to === 'peak') {
    return [
      '【dsh-damage-pulse · 峰时提醒】',
      '',
      '叮咚～现在进入峰时段啦（北京时间）！( •̀ ω •́ )✧',
      '安排调用时记得留意峰时价格哦～',
      '',
      ...schedule,
      '',
      '鲸鱼娘会继续帮你盯着余额和消耗～',
    ].join('\n')
  }
  return [
    '【dsh-damage-pulse · 谷时提醒】',
    '',
    '好消息～现在进入谷时段啦（北京时间）！ヾ(≧▽≦*)o',
    '想安排调用的话，可以留意一下现在的谷时价格哦～',
    '',
    ...schedule,
    '',
    '鲸鱼娘会继续乖乖守着余额变化～',
  ].join('\n')
}

/**
 * Bind the scheduler to the plugin lifecycle. Notification failures are
 * contained here and never enter accounting, persistence, or request paths.
 */
export function attachPeakBoundaryReminder(
  ctx: PeakReminderContext,
  sender: PeakReminderSender,
  options: PeakReminderOptions = {},
): void {
  const warn = options.warn ?? (message => console.warn(message))
  const scheduler = new PeakTransitionScheduler(async (transition) => {
    options.onTransition?.(transition)
    const settings = options.settings?.() ?? DEFAULT_PEAK_REMINDER_SETTINGS
    if (!settings.peakReminderEnabled) return
    if (transition.to === 'peak' && !settings.peakReminderEnterPeak) return
    if (transition.to === 'offPeak' && !settings.peakReminderEnterValley) return
    const result = await sender.send(formatPeakTransitionMessage(transition))
    if (!result.ok) {
      warn(`[dsh-token-monitor] 微信峰谷提醒发送失败（不影响计费/UI）: ${result.detail}`)
    }
  }, {
    ...(options.clock === undefined ? {} : { clock: options.clock }),
    onError: error => warn(`[dsh-token-monitor] 微信峰谷提醒异常（不影响计费/UI）: ${String(error)}`),
  })

  ctx.effect(() => {
    scheduler.start()
    return () => scheduler.stop()
  }, 'dsh-token-monitor: peak boundary reminder')
}
