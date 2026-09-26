/**
 * tokenCost projection：fold collector 写入的冻结 token-usage/record，累计每个会话的 token 用量与金额。
 * 经 session-projection 缝自动推送（registry 快照 / 变更流 / session/projection 帧），
 * Web Client 据此渲染「会话累计」统计条。
 * 定义同时携带两代 DSH 宿主的字段：0.1.0-rc.6/rc.7/rc.8 读取 schema/view，
 * 0.1.1-rc.1/rc.2 读取 stateSchema/wire；两侧 registry 都只消费自己认识的字段。
 * @module dsh-token-monitor/projection
 */

import { z, type ZodType } from 'zod'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type { PricingTable } from './pricing.ts'
import { isValidUsageRecord, type TokenCostProjection, type TokenCostState } from './types.ts'

/** Persisted fold state (the DSH 0.1.1 wire contract validates this shape). */
const stateSchema = z.object({
  calls: z.number().int().nonnegative(),
  inputTokens: z.number().int().nonnegative(),
  cacheReadTokens: z.number().int().nonnegative(),
  cacheWriteTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cost: z.number().nonnegative(),
  lastActivity: z.number().nonnegative(),
}).strict()

/** Client-facing aggregate; derived fields stay out of persisted fold state. */
const viewSchema = z.object({
  calls: z.number().int().nonnegative(),
  inputTokens: z.number().int().nonnegative(),
  cacheReadTokens: z.number().int().nonnegative(),
  cacheWriteTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
  cost: z.number().nonnegative(),
  lastActivity: z.number().nonnegative(),
}).strict()

type TokenCostProjectionDefinition = Omit<
  ProjectionDefinition<'tokenCost', TokenCostState>,
  'wire'
> & {
  wire: NonNullable<ProjectionDefinition<'tokenCost', TokenCostState>['wire']>
  /**
   * 旧 DSH 宿主字段（0.1.0-rc.6/rc.7/rc.8 的 schema/view 单表形态）。
   * 旧 registry 只读取 schema.parse(view(state))；新 registry 只读取
   * stateSchema/wire。两侧共用同一份约束（viewSchema）与实现（wireView），
   * 保证任意宿主上产出的 wire 值一致。
   */
  schema: ZodType<TokenCostProjection>
  view: (state: TokenCostState) => TokenCostProjection
}

/** 按给定价格表构造 tokenCost projection 单元。 */
export function createTokenCostProjectionDefinition(
  _priceTable: PricingTable,
): TokenCostProjectionDefinition {
  /** 共享的 state → wire 投影：旧宿主经 view 读取，新宿主经 wire.view 读取。 */
  const wireView = (state: TokenCostState): TokenCostProjection => ({
    calls: state.calls,
    inputTokens: state.inputTokens,
    cacheReadTokens: state.cacheReadTokens,
    cacheWriteTokens: state.cacheWriteTokens,
    outputTokens: state.outputTokens,
    totalTokens: state.inputTokens + state.cacheReadTokens + state.cacheWriteTokens + state.outputTokens,
    cost: state.cost,
    lastActivity: state.lastActivity,
  })
  return {
    key: 'tokenCost',
    stateSchema,
    init: () => ({
      calls: 0,
      inputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 0,
      cost: 0,
      lastActivity: 0,
    }),
    apply: (state, event) => {
      // 旧代际日志读回时宿主把本插件的事件改名为 plugin:token-usage/record；
      // 两种拼写承载同一份记录，只认一种会让历史会话折叠为零。
      if (event.type !== 'token-usage/record' && event.type !== 'plugin:token-usage/record') return state
      const record = event.data.record
      if (!isValidUsageRecord(record)) return state
      const { inputTokens, cacheReadTokens, cacheWriteTokens, outputTokens } = record

      return {
        ...state,
        calls: state.calls + 1,
        inputTokens: state.inputTokens + inputTokens,
        cacheReadTokens: state.cacheReadTokens + cacheReadTokens,
        cacheWriteTokens: state.cacheWriteTokens + cacheWriteTokens,
        outputTokens: state.outputTokens + outputTokens,
        cost: state.cost + record.cost,
        lastActivity: Math.max(state.lastActivity, record.timestamp),
      }
    },
    wire: {
      viewSchema,
      view: wireView,
    },
    // 旧 DSH 宿主字段：schema 校验 wire 值、view 输出 wire 值，与新宿主共用实现。
    schema: viewSchema,
    view: wireView,
    // Preserve existing checkpoints as the legacy baseline; new folds use frozen records.
    // v5 checkpoints can contain a zero-valued tokenCost row written before
    // historical records were folded correctly. Bump the state version so
    // the host rejects those rows and cold-rebuilds from the durable log.
    // v6 rows repeat that failure for sessions logged before the current session
    // format: the host returns those events namespaced as plugin:token-usage/record,
    // so a v6 fold dropped every usage record of such a session.
    stateVersion: 7,
  }
}
