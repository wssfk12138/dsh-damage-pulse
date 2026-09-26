import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import ts from 'typescript'
import tsconfigPaths from 'vite-tsconfig-paths'
import { defineConfig } from 'vitest/config'
import { standardDecoratorPlugin } from '../../vitest.shared.ts'

// Bare third-party packages the plugin's own node_modules does not expose; the root
// pnpm store holds the single copy, so point at it explicitly.
const storeDependency = (entry: string) => resolve(__dirname, '../../node_modules/.pnpm', entry)

// 构建后的 host/*.mjs 会从临时 home 里按裸标识符 import 第三方包；那里的解析路径
// 不含本仓库。把根 store 里的实现映射到「仅由无扩展名裸标识符」触发的 resolve 钩子上，
// 这样任何位置（含 .tmp-rel、临时目录）的产物都能拿到同一份依赖，而不会污染源码导入。
const externalPackages = new Map<string, string>([
  ['zod', storeDependency('zod@4.4.3/node_modules/zod')],
])
const externalBareSpecifier = (id: string) => !id.startsWith('.') && !id.startsWith('/') && !id.startsWith(String.fromCharCode(92))
  && !/^[a-zA-Z]:[\\/]/u.test(id) && !id.startsWith('node:') && !/\.[cm]?[jt]sx?$/u.test(id)

/** Read the repo's single source-resolution table (`tsconfig.base.json` paths), comments and all. */
function readBasePaths(): Record<string, string[]> {
  const configPath = resolve(__dirname, '../../tsconfig.base.json')
  const parsed = ts.parseConfigFileTextToJson(configPath, ts.sys.readFile(configPath)!)
  if (parsed.error !== undefined) {
    throw new Error('vitest.config: cannot parse tsconfig.base.json: ' + ts.flattenDiagnosticMessageText(parsed.error.messageText, ' '))
  }
  return (parsed.config as { compilerOptions: { paths: Record<string, string[]> } }).compilerOptions.paths
}

/** Resolve a tsconfig path target (directory or file) to an existing entry module. */
function entryFileFor(target: string): string | undefined {
  const candidate = resolve(__dirname, '../..', target)
  const options = /\.[cm]?tsx?$/u.test(candidate) ? [candidate] : [candidate + '.ts', resolve(candidate, 'index.ts')]
  return options.find(option => existsSync(option))
}

// 插件不在 pnpm workspace 的 node_modules 暴露范围内，且多数包的 exports 指向未构建的
// lib/；这里把 tsconfig.base.json 的 paths 展开成显式别名（别名优先于包导出），使测试加载
// 源码而不是缺失的产物。与根 vitest.config.ts 依赖同一张表，两边不会漂移。
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
const aliases: Array<{ find: string | RegExp; replacement: string }> = []
for (const [specifier, targets] of Object.entries(readBasePaths())) {
  const target = targets[0]
  if (target === undefined) continue
  const star = specifier.indexOf('*')
  if (star < 0) {
    const file = entryFileFor(target)
    if (file !== undefined) aliases.push({ find: specifier, replacement: file })
    continue
  }
  // 通配条目按前缀/后缀保留形状，把匹配到的片段交给目标的 `*` 位置。
  const prefix = specifier.slice(0, star)
  const suffix = specifier.slice(star + 1)
  const targetStar = target.indexOf('*')
  if (targetStar < 0) continue
  const directory = resolve(__dirname, '../..', target.slice(0, targetStar))
  const tail = target.slice(targetStar + 1)
  const file = entryFileFor(target.replace('*', 'x'))
  const replacement = tail === '' ? resolve(directory, '$1', 'index.ts') : directory + '$1' + tail
  void file
  aliases.push({
    find: new RegExp('^' + escapeRegExp(prefix) + '(.+?)' + escapeRegExp(suffix) + '$'),
    replacement,
  })
}

/** 产物从临时 home 里按裸标识符取依赖时，把根 store 里的实现交给 Vite 的外部化流程。 */
const externalPackagesPlugin = {
  name: 'token-monitor: external packages for built host modules',
  enforce: 'pre' as const,
  resolveId(source: string, importer?: string) {
    if (importer === undefined || !externalBareSpecifier(source)) return undefined
    const directory = externalPackages.get(source)
    if (directory === undefined) return undefined
    return resolve(directory, 'index.cjs')
  },
}

export default defineConfig({
  plugins: [tsconfigPaths({ projects: [resolve(__dirname, '../../tsconfig.base.json')] }), standardDecoratorPlugin(), externalPackagesPlugin],
  resolve: { alias: [...aliases, { find: 'yaml', replacement: storeDependency('yaml@2.8.1/node_modules/yaml') }] },
  test: { include: ['tests/**/*.spec.ts'] },
})
