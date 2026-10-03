/** Keyless script management endpoints and model tools. */
import type { Context } from '@deepseek-ai/cordis'
import type { ServerResponse } from 'node:http'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type {} from '@deepseek-ai/dsh-client-connection'
import { BalanceEndpointMismatchError, SensitiveBalanceScriptError, type BalanceScriptConfig } from './balance-config.ts'
import type { BalanceRegistry } from './balance-registry.ts'
import { BalanceScriptConflictError, validateBalanceEndpoint } from './balance-storage.ts'
import { createRouteGuard } from './http-trust.ts'

function send(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(value))
}
function assertProvider(ctx: Context, provider: string): void {
  if (!ctx.llm.listConfigurableProviders().some(item => item.provider === provider)) throw new TypeError('Unknown configured provider')
}
/** Register script APIs and shared balance reads on the owning context.
 * @param ctx Context with web server and LLM directory.
 * @param scripts Provider-local script store.
 * @param registry Shared query cache.
 */
export function registerBalanceApi(ctx: Context, scripts: BalanceScriptConfig, registry: BalanceRegistry): void {
  const guard = createRouteGuard(ctx)
  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/api/token-monitor/balance', handler: async (req, res) => {
    if (!guard(req, res)) return
    if (req.method !== 'GET') { send(res, 405, { error: { code: 'METHOD_NOT_ALLOWED' } }); return }
    const provider = new URL(req.url ?? '/', 'http://localhost').searchParams.get('provider') ?? 'deepseek-official'
    try { assertProvider(ctx, provider); send(res, 200, await registry.get(provider) ?? null) }
    catch { send(res, 200, null) }
  } }), 'dsh-token-monitor: provider balance route')
  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/api/token-monitor/balance-script', handler: async (req, res) => {
    if (!guard(req, res)) return
    const provider = new URL(req.url ?? '/', 'http://localhost').searchParams.get('provider') ?? ''
    try { assertProvider(ctx, provider) } catch { send(res, 400, { error: { code: 'UNKNOWN_PROVIDER' } }); return }
    if (req.method === 'GET') {
      try { send(res, 200, await scripts.read(provider)) }
      catch { send(res, 500, { error: { code: 'READ_FAILED' } }) }
      return
    }
    if (req.method !== 'PUT') { send(res, 405, { error: { code: 'METHOD_NOT_ALLOWED' } }); return }
    if (req.headers['content-type']?.split(';')[0]?.trim() !== 'application/json') { send(res, 415, { error: { code: 'UNSUPPORTED_MEDIA_TYPE' } }); return }
    let script: string | undefined, enabled: boolean | undefined, revision: number
    try {
      const chunks: Buffer[] = []; let size = 0
      for await (const chunk of req) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        size += buffer.length
        if (size > 200_000) { req.resume(); send(res, 413, { error: { code: 'PAYLOAD_TOO_LARGE' } }); return }
        chunks.push(buffer)
      }
      const body: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new TypeError()
      const fields = body as Record<string, unknown>
      const nativeSwitch = provider === 'deepseek-account' && typeof fields.enabled === 'boolean' && fields.script === undefined
      const scriptEdit = typeof fields.script === 'string' && Buffer.byteLength(fields.script) <= 32_768 && fields.enabled === undefined
      if ((!nativeSwitch && !scriptEdit)
        || typeof fields.expectedRevision !== 'number' || !Number.isSafeInteger(fields.expectedRevision) || fields.expectedRevision < 0
        || Object.keys(fields).some(key => !['script', 'enabled', 'expectedRevision'].includes(key))) throw new TypeError()
      script = fields.script as string | undefined; enabled = fields.enabled as boolean | undefined; revision = fields.expectedRevision
    } catch { send(res, 400, { error: { code: 'INVALID_REQUEST' } }); return }
    try {
      const saved = enabled === undefined ? await scripts.update(provider, script!, revision) : await scripts.updateNative(provider, enabled, revision)
      registry.invalidate(provider)
      send(res, 200, saved)
    } catch (error) {
      const conflict = error instanceof BalanceScriptConflictError
      const sensitive = error instanceof SensitiveBalanceScriptError
      const invalid = error instanceof TypeError
      send(res, conflict ? 409 : sensitive || invalid ? 400 : 500,
        { error: { code: conflict ? 'CONFLICT' : sensitive ? 'SENSITIVE_SCRIPT' : invalid ? 'INVALID_REQUEST' : 'WRITE_FAILED' } })
    }
  } }), 'dsh-token-monitor: provider script route')
  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/api/token-monitor/balance-endpoint', handler: async (req, res) => {
    if (!guard(req, res)) return
    if (req.method !== 'PUT') { send(res, 405, { error: { code: 'METHOD_NOT_ALLOWED' } }); return }
    if (req.headers['content-type']?.split(';')[0]?.trim() !== 'application/json') { send(res, 415, { error: { code: 'UNSUPPORTED_MEDIA_TYPE' } }); return }
    const provider = new URL(req.url ?? '/', 'http://localhost').searchParams.get('provider') ?? ''
    try { assertProvider(ctx, provider) } catch { send(res, 400, { error: { code: 'UNKNOWN_PROVIDER' } }); return }
    let endpoint: unknown
    try {
      const chunks: Buffer[] = []; let size = 0
      for await (const chunk of req) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        size += buffer.length
        if (size > 4_096) { req.resume(); send(res, 413, { error: { code: 'PAYLOAD_TOO_LARGE' } }); return }
        chunks.push(buffer)
      }
      endpoint = validateBalanceEndpoint(JSON.parse(Buffer.concat(chunks).toString('utf8')))
    } catch { send(res, 400, { error: { code: 'INVALID_REQUEST' } }); return }
    try {
      send(res, 200, await scripts.approve(provider, endpoint))
      registry.invalidate(provider)
    } catch (error) {
      const mismatch = error instanceof BalanceEndpointMismatchError
      send(res, mismatch ? 400 : 500, { error: { code: mismatch ? 'ENDPOINT_NOT_REQUESTED' : 'WRITE_FAILED' } })
    }
  } }), 'dsh-token-monitor: provider endpoint approval route')
}

/** Model-authored adapters remain keyless and use the same revision checks as the editor.
 * @param ctx Context with tools and configurable provider directory.
 * @param scripts Provider-local script store.
 * @param registry Shared query cache.
 */
export function registerBalanceTools(ctx: Context, scripts: BalanceScriptConfig, registry: BalanceRegistry): void {
  const output = { schema: { type: 'json' } as const, render: (_args: unknown, value: JsonValue) => [{ type: 'text' as const, text: JSON.stringify(value) }] }
  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'token_monitor_balance_get',
    description: 'For deepseek-account, source native-account uses the Host native balance service: scripts and endpoint approvals do not apply. Use enabled=true/false (without script) with the observed revision to resume/pause queries. Legacy paused script settings remain paused until explicit enabling. Empty script is supported only as a compatibility pause; nonempty native scripts are rejected. Read the saved keyless balance script, its status and its provider-local revision. One script is shared by all models of that provider. Does not expose API keys or query balances. A provider whose configured endpoint belongs to a gateway the Host already ships an adapter for returns that adapter with source "built-in"; it needs no script and is approved by construction, so do not ask the user to configure one for it. Status "unapproved" means the saved adapter names an endpoint the owner has not approved; the owner approves it in the Token Monitor balance settings, and only the endpoint the saved adapter names can be approved.',
    parameters: { provider: { type: 'string', required: true } }, output,
    async execute(args, exec) { exec.signal.throwIfAborted(); assertProvider(ctx, args.provider); return await scripts.read(args.provider) as unknown as JsonValue },
    presentCall: () => ({ card: 'generic', title: '读取供应商余额脚本', kind: 'read' }),
  })), 'dsh-token-monitor: read balance script tool')
  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'token_monitor_balance_update',
    description: 'For deepseek-account, source native-account uses the Host native balance service: scripts and endpoint approvals do not apply. Use enabled=true/false (without script) with the observed revision to resume/pause queries. Legacy paused script settings remain paused until explicit enabling. Empty script is supported only as a compatibility pause; nonempty native scripts are rejected. Save a complete balance adapter only when requested by the user. Read token_monitor_balance_get first. A provider that already reports source "built-in" needs no saved script; saving one replaces that shipped adapter, and the replacement endpoint then needs its own approval. Expression format: ({request:{path,method:"GET"|"POST",auth:"bearer"|"x-api-key",body?:string},parse(response){return {currency,totalBalance,grantedBalance?,toppedUpBalance?,isAvailable?}}}). Path must start with one / and contain no origin, query, fragment or credentials. API endpoint and key are Host-private and must never appear in source. Only these string literals may appear: the request path, the values GET/POST/bearer/x-api-key/credits, short codes, field names of at most 14 identifier characters, and a JSON body whose own string values follow the same rule; URLs, credentials, query strings, template substitution and escape sequences are rejected outright. No imports, network, Node globals, async code or secret access. Source limit 32KiB, execution 100ms/8MiB. Empty script disables querying (including a built-in adapter); ordinary invalid edits are saved and pause querying, while refused source is rejected without being stored. A valid edit whose endpoint is not approved yet stays paused until the owner approves that exact path and method in the settings panel; writes are never approved automatically. Historical usage is unchanged. Revision conflict requires rereading, never blind overwrite.',
    parameters: { provider: { type: 'string', required: true }, script: { type: 'string' }, enabled: { type: 'boolean' }, expectedRevision: { type: 'integer', required: true } }, output,
    async execute(args, exec) {
      exec.signal.throwIfAborted(); assertProvider(ctx, args.provider)
      const switchEdit = args.provider === 'deepseek-account' && typeof args.enabled === 'boolean' && args.script === undefined
      const scriptEdit = typeof args.script === 'string' && args.enabled === undefined
      if (!switchEdit && !scriptEdit) throw new TypeError('Provide either a script or a native-account enabled switch')
      const saved = switchEdit ? await scripts.updateNative(args.provider, args.enabled!, args.expectedRevision) : await scripts.update(args.provider, args.script!, args.expectedRevision)
      registry.invalidate(args.provider)
      return saved as unknown as JsonValue
    },
    presentCall: args => ({ card: 'generic', title: '修改供应商余额脚本', rawInput: { provider: args.provider } }),
    presentResult: (_args, result) => ({ card: 'generic', title: result.isError ? '余额脚本未保存' : '余额脚本已保存', content: result.content }),
  })), 'dsh-token-monitor: update balance script tool')
}
