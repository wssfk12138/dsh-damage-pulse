import type { Context } from '@deepseek-ai/cordis'

type LegacyColdSnapshot = (id: unknown) => Promise<unknown>
type CurrentColdSnapshot = (meta: unknown, events: readonly unknown[]) => unknown

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return typeof value === 'object'
    && value !== null
    && 'then' in value
    && typeof value.then === 'function'
}

function isMissingEventsContractError(error: unknown): boolean {
  return error instanceof TypeError
    && error.message.includes('undefined')
    && error.message.includes('at')
}

/**
 * 0.1.0/0.1.1 的 coldSnapshot(id) 为异步持久化冷读；0.1.2-alpha.1
 * 改为同步 coldSnapshot(meta, events)。旧契约返回 Promise；新版按旧契约调用时
 * 会在读取缺失 events 前同步抛错，此时再读取完整 inspection 并切换到新契约。
 */
async function rebuildTokenCostSnapshot(ctx: Context, sessionId: unknown): Promise<void> {
  const coldSnapshot = ctx.sessionProjectionCache.coldSnapshot as unknown as Function
  let legacyResult: unknown
  try {
    legacyResult = (coldSnapshot as LegacyColdSnapshot).call(
      ctx.sessionProjectionCache,
      sessionId,
    )
  } catch (error) {
    if (!isMissingEventsContractError(error)) throw error
    const inspection = await ctx.sessionPersistence.inspect(sessionId as never)
    const currentColdSnapshot = coldSnapshot as CurrentColdSnapshot
    currentColdSnapshot.call(ctx.sessionProjectionCache, inspection.meta, inspection.events)
    return
  }

  if (isPromiseLike(legacyResult)) await legacyResult
}

/** 为缺失 tokenCost 投影的历史会话触发一次兼容宿主版本的冷读重建。 */
export async function migrateMissingTokenCost(ctx: Context): Promise<void> {
  try {
    const headers = await ctx.sessionPersistence.list()
    let migrated = 0
    for (const header of headers) {
      const cached = ctx.sessionProjectionCache.cachedSnapshot(header)
      if (cached?.values.tokenCost !== undefined) continue
      await rebuildTokenCostSnapshot(ctx, header.id)
      migrated++
    }
    if (migrated > 0) {
      console.log(`[dsh-token-monitor] 已为 ${migrated} 个历史会话重建 tokenCost 投影`)
    }
  } catch (error) {
    console.warn(`[dsh-token-monitor] 历史会话投影迁移失败: ${String(error)}`)
  }
}
