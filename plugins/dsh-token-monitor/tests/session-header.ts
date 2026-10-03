import { SESSION_FORMAT_VERSION, SessionId, type SessionHeader } from '@deepseek-ai/dsh-session'

/** Valid immutable metadata for projection-only synthetic sessions. */
export function sessionHeader(id = 's1'): SessionHeader {
  return { version: SESSION_FORMAT_VERSION, id: SessionId(id), createdAt: 0, isSeeded: false }
}
