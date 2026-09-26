import type { TsdownPlugin, UserConfig } from 'tsdown'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { basename, dirname, isAbsolute, resolve as resolvePath } from 'node:path'
import { transform } from 'lightningcss'

const CLIENT_EXTERNALS = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-connection/client',
]

const host: UserConfig = {
  tsconfig: 'tsconfig.bundle.json',
  entry: { index: 'plugins/dsh-token-monitor/src/index.ts' },
  outDir: 'lib',
  format: 'esm',
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: true,
}

/**
 * Compile stylesheets inside the browser bundle instead of letting tsdown
 * extract them into lib/style.css. A standard-package install fetches the
 * client factory through the module loader and only receives the files listed
 * in package.json, so the bundle has to own its styles: every `.module.css`
 * becomes a hashed class map plus one tagged injector, and a plain `.css`
 * import becomes the same injector without a class map. This mirrors the
 * mechanism the internal client preset (packages/client/tsdown.client.ts) uses
 * for the harness build, where the runtime client artifact carries its own
 * styles; extracting them here leaves the class names in the bundle and the
 * rules behind in a file the package does not ship.
 */
const CSS_VIRTUAL_PREFIX = '\0dsh-css:'
const GLOBAL_CSS_VIRTUAL_PREFIX = '\0dsh-global-css:'
const CSS_VIRTUAL_SUFFIX = '.mjs'
const CLIENT_ID = 'dsh-damage-pulse'

/** Emit one plugin-owned style injector and an optional CSS Modules export. */
function styleInjectionModule(fileId: string, css: string, classMap?: Readonly<Record<string, string>>): string {
  const source = [
    `const css = ${JSON.stringify(css)};`,
    `const tagId = ${JSON.stringify(`${CLIENT_ID}/${basename(fileId)}`)};`,
    "if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css=' + JSON.stringify(tagId) + ']') === null) {",
    "  const tag = document.createElement('style');",
    `  tag.dataset.plugin = ${JSON.stringify(CLIENT_ID)};`,
    '  tag.dataset.pluginCss = tagId;',
    '  tag.textContent = css;',
    '  document.head.appendChild(tag);',
    '}',
  ]
  source.push(classMap === undefined ? 'export {};' : `export default ${JSON.stringify(classMap)};`)
  return source.join('\n')
}

/** Resolve a stylesheet specifier the way the bundler would. */
function resolveStylesheet(source: string, importer: string): string {
  if (!source.startsWith('.') && !isAbsolute(source)) return createRequire(importer).resolve(source)
  return resolvePath(dirname(importer), source)
}

const cssModulesInline: TsdownPlugin = {
  name: 'dsh-css-modules-inline',
  resolveId(source, importer) {
    if (!source.endsWith('.module.css')) return null
    const fileId = importer === undefined ? source : resolveStylesheet(source, importer)
    return CSS_VIRTUAL_PREFIX + fileId + CSS_VIRTUAL_SUFFIX
  },
  async load(virtualId) {
    if (!virtualId.startsWith(CSS_VIRTUAL_PREFIX)) return null
    const fileId = virtualId.slice(CSS_VIRTUAL_PREFIX.length, -CSS_VIRTUAL_SUFFIX.length)
    this.addWatchFile(fileId)
    const source = await readFile(fileId)
    const { code, exports: cssExports } = transform({
      filename: fileId,
      code: source,
      cssModules: { pattern: '[hash]_[local]' },
      minify: true,
    })
    const classMap: Record<string, string> = {}
    const entries = Object.entries(cssExports ?? {}).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    for (const [local, exported] of entries) classMap[local] = exported.name
    return styleInjectionModule(fileId, code.toString(), classMap)
  },
}

const globalCssInline: TsdownPlugin = {
  name: 'dsh-css-global-inline',
  resolveId(source, importer) {
    if (!source.endsWith('.css') || source.endsWith('.module.css')) return null
    const fileId = importer === undefined ? source : resolveStylesheet(source, importer)
    return GLOBAL_CSS_VIRTUAL_PREFIX + fileId + CSS_VIRTUAL_SUFFIX
  },
  async load(virtualId) {
    if (!virtualId.startsWith(GLOBAL_CSS_VIRTUAL_PREFIX)) return null
    const fileId = virtualId.slice(GLOBAL_CSS_VIRTUAL_PREFIX.length, -CSS_VIRTUAL_SUFFIX.length)
    this.addWatchFile(fileId)
    const source = await readFile(fileId)
    const { code } = transform({ filename: fileId, code: source, minify: true })
    return styleInjectionModule(fileId, code.toString())
  },
}

const client: UserConfig = {
  tsconfig: 'tsconfig.bundle.json',
  entry: { client: 'packages/client/ui-token-monitor/src/client/index.ts' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  dts: false,
  sourcemap: true,
  clean: false,
  external: CLIENT_EXTERNALS,
  plugins: [cssModulesInline, globalCssInline],
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
  },
  noExternal: (id: string) => CLIENT_EXTERNALS.includes(id) ? undefined : true,
  outputOptions: {
    entryFileNames: 'client.js',
    banner: 'window.__ModuleLoader__.load({ id: "dsh-damage-pulse", factory: (require) => {',
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
    codeSplitting: false,
  },
}

export default [host, client] satisfies UserConfig[]
