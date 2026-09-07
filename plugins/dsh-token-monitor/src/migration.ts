import type { Context } from '@deepseek-ai/cordis'

type LegacyColdSnapshot = (id: unknown) => Promise<unknown>
type PreviousColdSnapshot = (meta: unknown, events: readonly unknown[]) => unknown
type CurrentColdSnapshot = (meta: unknown, inheritedEventCount: unknown, events: readonly unknown[]) => unknown
type SessionInspection = {
  meta: { id: unknown }
  inheritedEventCount?: unknown
  events: readonly unknown[]
}
type SessionListEntry = SessionInspection['meta'] | { header: SessionInspection['meta'] }

type LegacyInspectionPersistence = {
  inspect?: (id: never) => Promise<SessionInspection>
  open?: (id: never, access: 'read') => Promise<{
    header: SessionInspection['meta']
    inheritedEventCount: unknown
    read: () => Promise<readonly unknown[]>
    close: () => Promise<void>
  }>
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return typeof value === 'object'
    && value !== null
    && 'then' in value
    && typeof value.then === 'function'
}

function isMissingArgumentContractError(error: unknown): boolean {
  return error instanceof TypeError
    && error.message.includes('undefined')
    && (error.message.includes('at') || error.message.includes('SessionLogOffset'))
}

async function inspectSession(ctx: Context, sessionId: unknown): Promise<SessionInspection> {
  const persistence = ctx.sessionPersistence as unknown as LegacyInspectionPersistence
  if (typeof persistence.inspect === 'function') return persistence.inspect(sessionId as never)
  if (typeof persistence.open !== 'function') throw new TypeError('session persistence has no readable inspection contract')

  const handle = await persistence.open(sessionId as never, 'read')
  try {
    return {
      meta: handle.header,
      inheritedEventCount: handle.inheritedEventCount,
      events: await handle.read(),
    }
  } finally {
    await handle.close()
  }
}

/**
 * 0.1.0/0.1.1 使用异步 coldSnapshot(id)，0.1.2-alpha.1 使用同步
 * coldSnapshot(meta, events)，0.1.2-rc.1 再加入 inheritedEventCount。
 */
async function rebuildTokenCostSnapshot(
  ctx: Context,
  sessionId: unknown,
  knownInspection?: SessionInspection,
): Promise<void> {
  const coldSnapshot = ctx.sessionProjectionCache.coldSnapshot as unknown as Function
  if (coldSnapshot.length >= 3) {
    const inspection = knownInspection
      ?? await inspectSession(ctx, sessionId)
    const currentColdSnapshot = coldSnapshot as CurrentColdSnapshot
    currentColdSnapshot.call(
      ctx.sessionProjectionCache,
      inspection.meta,
      inspection.inheritedEventCount,
      inspection.events,
    )
    return
  }

  let legacyResult: unknown
  try {
    legacyResult = (coldSnapshot as LegacyColdSnapshot).call(
      ctx.sessionProjectionCache,
      sessionId,
    )
  } catch (error) {
    if (!isMissingArgumentContractError(error)) throw error
    const inspection = knownInspection
      ?? await inspectSession(ctx, sessionId)
    const previousColdSnapshot = coldSnapshot as PreviousColdSnapshot
    previousColdSnapshot.call(ctx.sessionProjectionCache, inspection.meta, inspection.events)
    return
  }

  if (isPromiseLike(legacyResult)) await legacyResult
}

/** 为缺失 tokenCost 投影的历史会话触发一次兼容宿主版本的冷读重建。 */
export async function migrateMissingTokenCost(ctx: Context): Promise<void> {
  let entries: readonly SessionListEntry[]
  try {
    entries = await ctx.sessionPersistence.list() as unknown as readonly SessionListEntry[]
  } catch (error) {
    console.warn(`[dsh-token-monitor] 历史会话投影迁移失败: ${String(error)}`)
    return
  }

  let migrated = 0
  for (const entry of entries) {
    const header = 'header' in entry ? entry.header : entry
    try {
      const cachedSnapshot = ctx.sessionProjectionCache.cachedSnapshot as unknown as Function
      let inspection: SessionInspection | undefined
      let cached: { values?: { tokenCost?: unknown } } | undefined
      if (cachedSnapshot.length >= 2) {
        inspection = await inspectSession(ctx, header.id)
        cached = cachedSnapshot.call(
          ctx.sessionProjectionCache,
          inspection.meta,
          inspection.inheritedEventCount,
        )
      } else {
        cached = cachedSnapshot.call(ctx.sessionProjectionCache, header)
      }
      if (cached?.values?.tokenCost !== undefined) continue
      await rebuildTokenCostSnapshot(ctx, header.id, inspection)
      migrated++
    } catch (error) {
      console.warn(`[dsh-token-monitor] 历史会话投影迁移失败 (${String(header.id)}): ${String(error)}`)
    }
  }
  if (migrated > 0) {
    console.log(`[dsh-token-monitor] 已为 ${migrated} 个历史会话重建 tokenCost 投影`)
  }
}
