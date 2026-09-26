import { describe, expect, it } from 'vitest'
import { OFFICIAL_BALANCE_SCRIPT } from '../src/balance-script.ts'
import { refuseScriptLiteral } from '../src/script-literals.ts'

const keyless = (extra = '') =>
  '({ request: { path: "/v1/usage", method: "GET", auth: "bearer" }, parse(response) { return { currency: "CNY", totalBalance: 1' + extra + ' } } })'

describe('balance script literal policy', () => {
  it('accepts the official seed and adapters the contract actually needs', () => {
    expect(refuseScriptLiteral(OFFICIAL_BALANCE_SCRIPT)).toBeUndefined()
    // Locals, optional chaining, a regular expression and numeric string handling stay allowed.
    const relay = '(() => { const rows = response?.data ?? []; const match = /"total"\s*:\s*([0-9.]+)/.exec(String(rows[0] ?? "")); '
      + 'return { request: { path: "/v1/usage", method: "GET", auth: "x-api-key" }, parse() { return { currency: "USD", totalBalance: match ? match[1] : 0, isAvailable: String(response?.code ?? 0) === "200" } } } })()'
    expect(refuseScriptLiteral(relay)).toBeUndefined()
    const posted = `({ request: { path: "/v1/quota", method: "POST", auth: "bearer", body: '{"model":"deepseek"}' }, parse() { return { currency: "CNY", totalBalance: 0 } } })`
    expect(refuseScriptLiteral(posted)).toBeUndefined()
  })

  it('refuses every pasted shape that used to reach settings', () => {
    const marker = 'FAKEFAKE'
    const samples: Array<[string, string]> = [
      ['a key on a custom name', 'const KEY = "sk-FAKE00000000000000"; ' + keyless()],
      ['a key on a lower camel name', 'const myKey = "sk-FAKE00000000000000"; ' + keyless()],
      ['a bare key literal in a comment', keyless() + ' /* sk-FAKE00000000000000 */'],
      ['a key literal after a spaced header name', keyless() + ' // API KEY "sk-FAKE00000000000000"'],
      ['a session cookie string', 'const cookie = "sessionid=FAKEFAKEFAKEFAKE"; ' + keyless()],
      ['a session token on a custom name', 'const sessionToken = "sess-FAKEFAKEFAKE"; ' + keyless()],
      ['a JWT literal', 'const t = "eyJFAKEFAKE.FAKEFAKE.FAKEFAKE"; ' + keyless()],
      ['an absolute endpoint', keyless() + ' + "https://api.example.com/v1/usage"'],
      ['an authorization header value', keyless() + ', h: { Authorization: "Bearer FAKEFAKE" }'],
      ['an api key passed as a header value', keyless() + ', h: { "x-api-key": "FAKEFAKE000000000000" }'],
    ]
    for (const [label, source] of samples) {
      const refused = refuseScriptLiteral(source)
      expect(refused, label).toBeDefined()
      expect(JSON.stringify(refused), label).not.toContain(marker)
    }
  })

  it('refuses template substitution and escape sequences without echoing them', () => {
    const templated = '({ request: { path: `/v1/${FAKEFAKE}`, method: "GET", auth: "bearer" }, parse() {} })'
    expect(refuseScriptLiteral(templated)?.reason).toBe('template')
    const escaped = '({ request: { path: "/v1/usage", method: "GET", body: "line\\nFAKEFAKE", auth: "bearer" }, parse() {} })'
    expect(refuseScriptLiteral(escaped)?.reason).toBe('escape')
    expect(JSON.stringify(refuseScriptLiteral(escaped))).not.toContain('FAKEFAKE')
  })

  it('reports position and length only, never the literal itself', () => {
    const refused = refuseScriptLiteral(keyless() + ', extra: "FAKEFAKE0000000000"')
    expect(refused).toEqual({ index: 5, length: 18, reason: 'literal' })
  })
})
