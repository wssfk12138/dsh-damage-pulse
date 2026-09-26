/**
 * 微信通知总开关门禁工厂：预算、峰谷、缓存异常三类通知共用。
 * 独立成轻量模块，避免测试/消费方拉入整个插件图。
 * @module dsh-token-monitor/wechat-gate
 */

import type { WechatNotifyResult } from '../../wechat-notify/src/sender.ts'

export interface WechatNotificationSender {
  send(message: string): Promise<WechatNotifyResult>
}

/** 共享的总开关门禁：关闭或发送器缺失时 fail-soft（返回 ok，不抛错）。 */
export function createGatedWechatSender(
  isEnabled: () => boolean,
  getSender: () => WechatNotificationSender | undefined,
) {
  return {
    async send(message: string) {
      const sender = getSender()
      if (!isEnabled() || sender === undefined) return { ok: true as const }
      return await sender.send(message)
    },
  }
}
