/**
 * Resolve one plugin-owned HTTP or asset route against the host document.
 *
 * The host may serve the application from a reverse-proxy subpath (for
 * example `/app/Harness/dsh/`). Its index document carries `<base href="./">`,
 * so `document.baseURI` is the authoritative directory for app-owned browser
 * routes. Prefixing those routes with `/` would escape the proxy mount.
 *
 * HTTP(S) routes stay paths so existing same-origin `/api/...` callers keep
 * their shape at the site root. Custom-scheme pages (the desktop shell uses
 * `dsh-app://app/`) receive an absolute URL because a path-only value would
 * resolve against the wrong origin.
 */

const ABSOLUTE_URL = /^[a-z][a-z\d+.-]*:/i

function documentBase(): string | undefined {
  if (typeof document === 'undefined') return undefined
  const base = document.baseURI
  return typeof base === 'string' && base.length > 0 ? base : undefined
}

/**
 * Resolve a Token Monitor route against the current application mount.
 * @param path - Plugin-owned route or asset path, normally beginning with `/`.
 * @param base - Optional document base for tests or non-document callers.
 * @returns A document-relative path at the root, a subpath-qualified path
 *   behind a reverse proxy, or an absolute URL for non-HTTP document schemes.
 */
export function tokenMonitorUrl(path: string, base: string | undefined = documentBase()): string {
  if (ABSOLUTE_URL.test(path) || path.startsWith('//') || base === undefined) return path

  let documentUrl: URL
  try {
    documentUrl = new URL(base)
  } catch {
    return path
  }

  try {
    const target = new URL(path.startsWith('/') ? path.slice(1) : path, documentUrl)
    if (target.protocol === 'http:' || target.protocol === 'https:') {
      return target.pathname + target.search + target.hash
    }
    return target.href
  } catch {
    return path
  }
}
