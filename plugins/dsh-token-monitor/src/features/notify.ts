/** Notification observation and timers stop independently from usage collection. */
import type { Context } from '@deepseek-ai/cordis'
import type { ModuleServices } from '../module-services.ts'
import { createProviderNotificationObserver } from '../provider-notifications.ts'
import { NotificationEventBuffer, createPeakTransitionNotification } from '../notification-events.ts'
import { registerNotificationEventsRoute } from '../notification-route.ts'
import { attachPeakBoundaryReminder } from '../peak-reminder.ts'
import { createGatedWechatSender } from '../wechat-gate.ts'

export function apply(ctx: Context, services: ModuleServices): void {
  const events = new NotificationEventBuffer()
  const pending = new Set<Promise<unknown>>()
  const observe = createProviderNotificationObserver(services.storage.history(), services.readProvider, (provider, draft, message) => {
    if (!events.publish(draft) || !services.readProvider(provider).wechatNotificationsEnabled || !services.wechat) return
    const delivery = services.wechat.send(`[${provider}] ${message}`).catch(() => undefined)
    pending.add(delivery)
    void delivery.finally(() => pending.delete(delivery))
  })
  ctx.effect(() => {
    services.observeRecord = observe
    return async () => {
      if (services.observeRecord === observe) delete services.observeRecord
      await Promise.allSettled(pending)
    }
  }, 'token-monitor: notification observer')
  const gatedSender = createGatedWechatSender(() => services.settings.user().wechatNotificationsEnabled, () => services.wechat)
  attachPeakBoundaryReminder(ctx, gatedSender, {
    settings: () => services.settings.user(),
    onTransition: transition => {
      const settings = services.readProvider('deepseek-official')
      if (settings.peakReminderEnabled && (transition.to === 'peak' ? settings.peakReminderEnterPeak : settings.peakReminderEnterValley)) events.publish(createPeakTransitionNotification(transition, 'deepseek-official'))
    },
  })
  ctx.inject(['webServer', 'connection'], web => registerNotificationEventsRoute(web, events))
}
