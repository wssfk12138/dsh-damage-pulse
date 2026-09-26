import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import { scrubbedParentEnv } from '@deepseek-ai/dsh-subprocess'

export type WechatNotifyResult =
  | { ok: true }
  | { ok: false; code: 'activation-required' | 'send-failed'; detail: string }

export interface WechatCommandInvocation {
  command: string
  args: readonly string[]
  env: NodeJS.ProcessEnv
  timeoutMs: number
}

export type WechatCommandRunner = (invocation: WechatCommandInvocation) => Promise<void>

export interface ClawbotWechatSenderOptions {
  clawbotIndex: string
  timeoutMs?: number
  tempDirectory?: string
  run?: WechatCommandRunner
}

const ACTIVATION_FAILURE = /prepare|context[\s_-]?token|登录|扫码|发过消息|login|expired|激活/i

function runCommand(invocation: WechatCommandInvocation): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(invocation.command, [...invocation.args], {
      encoding: 'utf8',
      env: invocation.env,
      timeout: invocation.timeoutMs,
      windowsHide: true,
    }, (error) => {
      if (error) reject(error)
      else resolve()
    })
  })
}

/** Extract bounded human-readable process failure text without throwing. */
export function describeFailure(error: unknown): string {
  if (error !== null && typeof error === 'object') {
    const value = error as { stderr?: unknown; stdout?: unknown; message?: unknown }
    const parts: string[] = []
    if (typeof value.stderr === 'string' && value.stderr.trim()) parts.push(value.stderr.trim())
    if (typeof value.stdout === 'string' && value.stdout.trim()) parts.push(value.stdout.trim())
    if (typeof value.message === 'string' && value.message.trim()) parts.push(value.message.trim())
    const text = parts.join(' | ').trim()
    if (text) return text.slice(0, 2_000)
  }
  return String(error).slice(0, 2_000)
}

/** Async UTF-8 ClawBot adapter shared by tools and background reminders. */
export class ClawbotWechatSender {
  private readonly timeoutMs: number
  private readonly tempDirectory: string
  private readonly run: WechatCommandRunner

  constructor(private readonly options: ClawbotWechatSenderOptions) {
    this.timeoutMs = options.timeoutMs ?? 30_000
    this.tempDirectory = options.tempDirectory ?? tmpdir()
    this.run = options.run ?? runCommand
  }

  async send(message: string): Promise<WechatNotifyResult> {
    if (this.options.clawbotIndex.trim().length === 0) {
      return {
        ok: false,
        code: 'send-failed',
        detail: '未配置 WECHAT_NOTIFY_CLAWBOT_INDEX',
      }
    }
    const privateDirectory = await mkdtemp(join(this.tempDirectory, 'dsh-wechat-notify-'))
    const messageFile = join(privateDirectory, 'message.txt')
    try {
      await writeFile(messageFile, message, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
      try {
        await this.run({
          command: process.execPath,
          args: [this.options.clawbotIndex, 'send', '--file', messageFile],
          env: scrubbedParentEnv(),
          timeoutMs: this.timeoutMs,
        })
        return { ok: true }
      } catch (error) {
        const detail = describeFailure(error)
        return {
          ok: false,
          code: ACTIVATION_FAILURE.test(detail) ? 'activation-required' : 'send-failed',
          detail,
        }
      }
    } finally {
      await rm(privateDirectory, { recursive: true, force: true }).catch(() => {})
    }
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    wechatNotify: WechatNotifyService
  }
}

/** Fail-soft notification capability for non-interactive plugin work. */
export class WechatNotifyService extends Service {
  constructor(ctx: Context, private readonly sender: Pick<ClawbotWechatSender, 'send'>) {
    super(ctx, 'wechatNotify')
  }

  async send(message: string): Promise<WechatNotifyResult> {
    try {
      return await this.sender.send(message)
    } catch (error) {
      return { ok: false, code: 'send-failed', detail: describeFailure(error) }
    }
  }
}

/** Test helper that reads the exact UTF-8 payload passed to a command runner. */
export async function readWechatMessage(invocation: WechatCommandInvocation): Promise<string> {
  const file = invocation.args[invocation.args.length - 1]
  if (file === undefined) throw new Error('wechat notify: missing message file argument')
  return await readFile(file, 'utf8')
}
