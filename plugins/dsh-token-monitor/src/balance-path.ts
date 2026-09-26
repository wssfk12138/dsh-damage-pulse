/** Validate a stored relative path without loading the optional script interpreter.
 * @param value Untrusted request path.
 * @returns Origin-free relative request path.
 */
export function validateBalancePath(value: unknown): string {
  if (typeof value !== 'string' || value.length > 2048 || !value.startsWith('/')
    || value.startsWith('//') || value.includes('\\') || value.includes('?') || value.includes('#')) {
    throw new Error('Balance request path must be absolute and contain no origin, query, fragment or backslash')
  }
  return value
}
