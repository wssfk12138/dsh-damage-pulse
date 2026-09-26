/**
 * wechat-notify 插件入口（实装版）：
 * 保留独立插件形态；ClawBot 入口只从 WECHAT_NOTIFY_CLAWBOT_INDEX 环境变量读取，三个微信工具经 tools.ts 服务层
 * 惰性注册，tools 服务缺失或配置为空时 fail-soft，不影响插件启动。
 * @module wechat-notify
 */

import type { Context } from '@deepseek-ai/cordis'
import {
  ClawbotFilesystemGateway,
  WechatConnectionAdapter,
  WechatConnectionService,
} from './connection.ts'
import { ClawbotWechatSender, WechatNotifyService } from './sender.ts'
import { registerWechatTools } from './tools.ts'

export const WECHAT_NOTIFY_CLAWBOT_INDEX_ENV = 'WECHAT_NOTIFY_CLAWBOT_INDEX'

export const name = 'wechat-notify'

export function apply(ctx: Context) {
  console.log('[wechat-notify] plugin loaded')
  const clawbotIndex = process.env[WECHAT_NOTIFY_CLAWBOT_INDEX_ENV]?.trim() || ''
  new WechatNotifyService(ctx, new ClawbotWechatSender({ clawbotIndex }))
  new WechatConnectionService(ctx, new WechatConnectionAdapter({
    gateway: new ClawbotFilesystemGateway({ clawbotIndex }),
  }))
  // 工具服务存在时惰性注册三个微信工具；缺失时静默跳过（旧版宿主无 tools 也能启动）。
  registerWechatTools(ctx)
}
