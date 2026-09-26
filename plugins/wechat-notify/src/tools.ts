/**
 * DSH agent 工具注册：wechat_notify / wechat_login / wechat_login_confirm。
 * 三个工具只调用现有 WechatNotifyService / WechatConnectionService，
 * 不读写 pending 文件、不硬编码路径；宿主没有 tools 服务时静默跳过注册。
 * @module wechat-notify/tools
 */

import type { Context } from "@deepseek-ai/cordis"
import { defineTool } from "@deepseek-ai/dsh-tools"
import type { ToolDefinition } from "@deepseek-ai/dsh-tools"
import { WechatConnectionError, type WechatConnectionService } from "./connection.ts"
import type { WechatNotifyResult, WechatNotifyService } from "./sender.ts"

export interface WechatToolEnvironment {
  notify: Pick<WechatNotifyService, "send"> | undefined
  connection: Pick<WechatConnectionService, "login" | "confirmLogin"> | undefined
}

const UNCONFIGURED_TEXT = "微信通道未配置：请在 Host 设置 WECHAT_NOTIFY_CLAWBOT_INDEX 并重启，或安装独立 dsh-wechat-notify 插件。"
const UNSUPPORTED_TEXT = "ClawBot 微信组件不可用：请确认 WECHAT_NOTIFY_CLAWBOT_INDEX 指向本机 ClawBot CLI 入口文件。"

/** 把发送结果转成 agent 可读文本（与旧版工具文案保持一致）。 */
function notifyText(result: WechatNotifyResult, message: string): string {
  if (result.ok) return `微信通知已发送：${message}`
  if (result.code === "activation-required") {
    return `微信通知发送失败：会话可能已过期或尚未激活。请先给 ClawBot 发一条消息激活，然后重试。原始错误：${result.detail}`
  }
  return `微信通知发送失败：${result.detail}`
}

/** 连接层错误转成可读文本；非 WechatConnectionError 返回 undefined 由调用方兜底。 */
function connectionText(error: unknown): string | undefined {
  if (!(error instanceof WechatConnectionError)) return undefined
  if (error.code === "UNSUPPORTED") return UNSUPPORTED_TEXT
  return `微信连接操作失败（${error.code}）：${error.message}`
}

/** 构造三个微信工具定义（纯函数，便于测试）。 */
export function createWechatTools(env: WechatToolEnvironment): ToolDefinition[] {
  return [
    defineTool({
      name: "wechat_notify",
      description: "通过微信给用户发一条通知，复用本机 ClawBot 微信通道（内置适配器或独立 dsh-wechat-notify 插件）。通知只发不拉取消息。",
      parameters: {
        message: {
          type: "string",
          required: true,
          description: "通知正文（支持中文）",
        },
      },
      output: {
        schema: { type: "string" },
        render: (_args, value) => [{ type: "text", text: value }],
      },
      async execute(args) {
        if (env.notify === undefined) return UNCONFIGURED_TEXT
        return notifyText(await env.notify.send(args.message), args.message)
      },
    }),
    defineTool({
      name: "wechat_login",
      description: "获取微信登录会话和二维码，返回 sessionId 与二维码；用户扫码后调用 wechat_login_confirm 完成登录。",
      parameters: {},
      output: {
        schema: { type: "string" },
        render: (_args, value) => [{ type: "text", text: value }],
      },
      async execute() {
        if (env.connection === undefined) return UNCONFIGURED_TEXT
        try {
          const start = await env.connection.login()
          const payload = start.login.qrPayload
          const qr = payload.startsWith("data:")
            ? payload.length < 4000 ? `二维码 data URL：${payload}` : "二维码已生成（data URL 较长，建议直接内嵌展示）。"
            : `二维码链接：${payload}`
          const minutes = Math.max(1, Math.round((start.login.expiresAt - Date.now()) / 60000))
          return `微信登录二维码已生成，请在约 ${minutes} 分钟内完成扫码。\nsessionId：${start.login.sessionId}\n${qr}\n\n请先用微信打开链接并扫码，然后调用 wechat_login_confirm 完成登录。`
        } catch (error) {
          return connectionText(error) ?? `获取微信登录二维码失败：${String(error)}`
        }
      },
    }),
    defineTool({
      name: "wechat_login_confirm",
      description: "确认微信扫码登录是否完成；用户扫码后调用本工具保存登录凭据。",
      parameters: {
        sessionId: {
          type: "string",
          required: true,
          description: "wechat_login 返回的登录会话标识",
        },
      },
      output: {
        schema: { type: "string" },
        render: (_args, value) => [{ type: "text", text: value }],
      },
      async execute(args) {
        if (env.connection === undefined) return UNCONFIGURED_TEXT
        try {
          const confirmation = await env.connection.confirmLogin(args.sessionId)
          switch (confirmation.result) {
            case "confirmed":
              return "登录成功！微信通道已连接，现在可以用 wechat_notify 发送通知了。"
            case "scanned":
              return "已扫码，请在手机上确认登录，然后再次调用 wechat_login_confirm。"
            case "expired":
              return "二维码已过期。请重新调用 wechat_login 获取新二维码。"
            default:
              return "尚未检测到扫码。请先用微信打开二维码链接并扫码，然后再次调用 wechat_login_confirm。"
          }
        } catch (error) {
          if (error instanceof WechatConnectionError && error.code === "LOGIN_SESSION_NOT_FOUND") {
            return "登录会话不存在或已失效。请先调用 wechat_login 获取新的二维码。"
          }
          return connectionText(error) ?? `确认登录失败：${String(error)}`
        }
      },
    }),
  ]
}

/**
 * 宿主提供 tools 服务时惰性注册三个微信工具；tools 缺失时回调不触发，插件照常启动。
 * 在 apply() 中于服务实例化之后调用，保证 wechatNotify/wechatConnection 已提供。
 */
export function registerWechatTools(ctx: Context): void {
  ctx.inject(["tools"], (toolsCtx) => {
    const registry = toolsCtx.tools
    if (registry === undefined || typeof registry.register !== "function") return
    const env: WechatToolEnvironment = {
      notify: ctx.get("wechatNotify", false),
      connection: ctx.get("wechatConnection", false),
    }
    for (const tool of createWechatTools(env)) registry.register(tool)
  })
}
