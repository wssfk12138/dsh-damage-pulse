import { readFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

type AssetRouteContext = Pick<import('@deepseek-ai/cordis').Context, 'webServer'>

export const TOKEN_MONITOR_ASSET_ROOT = fileURLToPath(
  // The public rebuild keeps package-owned assets at the repository root.
  // Resolve from the source tree so source-plane tests and a non-packed
  // checkout use the same asset set that build-modules.mjs packages.
  new URL('../../../assets/dsh-token-monitor/', import.meta.url),
)

export const TOKEN_MONITOR_ASSET_ROUTES = [
  { path: '/assets/dsh-token-monitor/whale-girl', directory: 'whale-girl' },
  { path: '/assets/dsh-token-monitor/settings-ui/cute', directory: 'settings-ui/cute' },
] as const

function isMissingFile(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'ENOENT'
}

function resolvePngPath(assetDirectory: string, routePath: string, requestUrl: string | undefined): string | undefined {
  let pathname: string
  try {
    pathname = decodeURIComponent(new URL(requestUrl ?? '/', 'http://localhost').pathname)
  } catch {
    return undefined
  }

  const relativePath = pathname.slice(routePath.length + 1)
  const segments = relativePath.split('/')
  if (
    !pathname.startsWith(`${routePath}/`)
    || !relativePath.toLowerCase().endsWith('.png')
    || segments.some(segment => segment === '' || segment === '.' || segment === '..' || segment.includes('\\') || segment.includes('\0'))
  ) {
    return undefined
  }

  const root = resolve(assetDirectory)
  const candidate = resolve(root, ...segments)
  return candidate.startsWith(`${root}${sep}`) ? candidate : undefined
}

export function createTokenMonitorAssetHandler(
  routePath: string,
  assetDirectory: string,
): (request: IncomingMessage, response: ServerResponse) => Promise<void> {
  return async (request, response) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { Allow: 'GET, HEAD' })
      response.end()
      return
    }

    const assetPath = resolvePngPath(assetDirectory, routePath, request.url)
    if (assetPath === undefined) {
      response.writeHead(404)
      response.end()
      return
    }

    let body: Buffer
    try {
      body = await readFile(assetPath)
    } catch (error) {
      response.writeHead(isMissingFile(error) ? 404 : 500)
      response.end()
      return
    }

    response.writeHead(200, {
      'Content-Type': 'image/png',
      'Content-Length': String(body.byteLength),
      'Cache-Control': 'public, max-age=3600',
    })
    response.end(request.method === 'HEAD' ? undefined : body)
  }
}

export function registerTokenMonitorAssetRoutes(
  ctx: AssetRouteContext,
  assetRoot = TOKEN_MONITOR_ASSET_ROOT,
): () => void {
  const disposers = TOKEN_MONITOR_ASSET_ROUTES.map(route => ctx.webServer.register({
    kind: 'prefix',
    path: route.path,
    handler: createTokenMonitorAssetHandler(route.path, resolve(assetRoot, route.directory)),
  }))
  return () => {
    for (const dispose of disposers.reverse()) dispose()
  }
}
