/**
 * Structural source policy for provider balance adapters.
 *
 * A saved adapter is keyless by contract: the Host owns the endpoint and the
 * credential, and the adapter only names a request and parses its response.
 * Guessing at credential-shaped *names* misses the shapes users actually paste
 * (custom variable names, session strings, JWTs, commented-out keys), so this
 * scanner walks every string literal the source declares and accepts only the
 * literal shapes the contract needs. Pasted credentials, absolute endpoints,
 * query strings and template code therefore cannot reach settings, the editor
 * or a model context.
 * @module dsh-token-monitor/script-literals
 */

/** Why one literal was refused; the literal's value is never returned. */
export interface RefusedScriptLiteral {
  /** One-based ordinal of the refused literal inside the source; 0 for a comment refusal. */
  index: number
  /** Character length of the refused literal or comment run. */
  length: number
  /** Machine-readable reason; the caller renders its own localized text. */
  reason: 'literal' | 'escape' | 'template' | 'comment'
}

/** Literal values the adapter contract itself defines. */
const ALLOWED_TOKENS = new Set(['GET', 'POST', 'bearer', 'x-api-key', 'credits'])
/** Credential-bearing property names an adapter never needs. */
const REFUSED_NAMES = new Set([
  'authorization', 'cookie', 'set-cookie', 'proxy-authorization', 'apikey', 'api_key', 'api-key',
  'access_token', 'refresh_token', 'token', 'secret', 'client_secret', 'password', 'passwd',
  'signature', 'credential', 'credentials', 'session', 'sessionid', 'session_id', 'session_token',
])
/** Short codes: currency, unit, HTTP status and similar bounded tokens. */
const SHORT_TOKEN = /^[A-Za-z0-9]{1,3}$/
/** The relative request path an adapter may name. */
const PATH_LITERAL = /^\/[A-Za-z0-9._~%/-]*$/
/** A response field name used with bracket access. */
const FIELD_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,13}$/
/** Prefix characters after which a slash opens a regular expression. */
const REGEX_PREFIX = new Set(['', '(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '^', '<', '>', '~'])
const MAX_JSON_DEPTH = 4
/** An unbroken token-like run inside a comment: the shape a pasted credential leaves behind. */
const COMMENT_RUN = /[A-Za-z0-9_+=\-]{20,}/

interface Literal {
  value: string
  index: number
  escaped: boolean
  template: boolean
}

function regexCanStart(previous: string): boolean {
  return REGEX_PREFIX.has(previous)
}

/** Skip one regular-expression literal, honouring escapes and character classes. */
function skipRegex(source: string, start: number): number {
  let index = start + 1
  let inClass = false
  while (index < source.length) {
    const character = source[index]!
    if (character === '\\') { index += 2; continue }
    if (character === '[') inClass = true
    else if (character === ']') inClass = false
    else if (character === '/' && !inClass) return index + 1
    else if (character === '\n') return index
    index += 1
  }
  return index
}

/** Collect every string literal; comments are skipped and regexes are not literals. */
function literalsOf(source: string): { literals: Literal[]; comments: string[] } {
  const literals: Literal[] = []
  const comments: string[] = []
  let index = 0
  let previous = ''
  while (index < source.length) {
    const character = source[index]!
    if (character === '/' && source[index + 1] === '/') {
      const end = source.indexOf('\n', index)
      comments.push(source.slice(index + 2, end === -1 ? source.length : end))
      index = end === -1 ? source.length : end + 1
      continue
    }
    if (character === '/' && source[index + 1] === '*') {
      const end = source.indexOf('*/', index + 2)
      comments.push(source.slice(index + 2, end === -1 ? source.length : end))
      index = end === -1 ? source.length : end + 2
      continue
    }
    if (character === '/' && regexCanStart(previous)) {
      index = skipRegex(source, index)
      previous = ')'
      continue
    }
    if (character === '"' || character === "'" || character === '`') {
      const quote = character
      let cursor = index + 1
      let escaped = false
      let template = false
      let closed = false
      while (cursor < source.length) {
        const inner = source[cursor]!
        if (inner === '\\') { cursor += 2; continue }
        if (inner === '\n') break
        if (quote === '`' && inner === '$' && source[cursor + 1] === '{') { template = true; break }
        if (inner === quote) { closed = true; break }
        cursor += 1
      }
      const raw = source.slice(index + 1, Math.min(cursor, source.length))
      if (raw.includes('\\')) escaped = true
      literals.push({ value: raw, index: literals.length + 1, escaped, template })
      if (!closed) return { literals, comments }
      index = cursor + 1
      previous = ')'
      continue
    }
    if (!/\s/.test(character)) previous = character
    index += 1
  }
  return { literals, comments }
}

/** Whether every string inside a parsed JSON literal satisfies the policy. */
function jsonLiteralAllowed(value: unknown, depth: number): boolean {
  if (depth > MAX_JSON_DEPTH) return false
  if (typeof value === 'string') return valueAllowed(value)
  if (Array.isArray(value)) return value.every(entry => jsonLiteralAllowed(entry, depth + 1))
  if (value !== null && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).every(entry => jsonLiteralAllowed(entry, depth + 1))
  }
  return true
}

/** Whether one literal value may appear in a saved adapter. */
function valueAllowed(value: string): boolean {
  if (value.length === 0) return true
  if (ALLOWED_TOKENS.has(value)) return true
  if (SHORT_TOKEN.test(value)) return true
  if (PATH_LITERAL.test(value)) return true
  if (FIELD_NAME.test(value)) return !REFUSED_NAMES.has(value.toLowerCase())
  if ((value.startsWith('{') && value.endsWith('}')) || (value.startsWith('[') && value.endsWith(']'))) {
    try {
      return jsonLiteralAllowed(JSON.parse(value) as unknown, 0)
    } catch {
      return false
    }
  }
  // A JSON body or string literal that is itself JSON text.
  if (value.startsWith('"') && value.endsWith('"') && value.length > 2) {
    try {
      return jsonLiteralAllowed(JSON.parse(value) as unknown, 0)
    } catch {
      return false
    }
  }
  return false
}

/**
 * Check one adapter source against the literal policy.
 * @param source Complete keyless adapter source as saved by an editor or tool.
 * @returns The first refused literal, or undefined when the source may be saved.
 */
export function refuseScriptLiteral(source: string): RefusedScriptLiteral | undefined {
  const { literals, comments } = literalsOf(source)
  for (const comment of comments) {
    const run = COMMENT_RUN.exec(comment)
    if (run !== null) return { index: 0, length: run[0].length, reason: 'comment' }
  }
  for (const literal of literals) {
    const refused = literal.template ? 'template' : literal.escaped ? 'escape' : valueAllowed(literal.value) ? undefined : 'literal'
    if (refused !== undefined) return { index: literal.index, length: literal.value.length, reason: refused }
  }
  return undefined
}
