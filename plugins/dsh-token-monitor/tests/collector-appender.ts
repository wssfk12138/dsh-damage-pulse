/** 测试用会话用量行写入器：按宿主已确认会落盘 ignorable 的形态写入。 */
import type { Session } from '@deepseek-ai/dsh-session'
import type { TokenUsageRecordData, UsageRecord } from '../src/types.ts'

export function appendUsageRecord(session: Session, record: UsageRecord): void {
  session.append('token-usage/record', { record } satisfies TokenUsageRecordData, { ignorable: true })
}
