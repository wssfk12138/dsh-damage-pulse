/** Build an explicit release directory. Never rebuild the live installation or its tombstones. */
import { build } from 'tsdown'
import { readFile, writeFile, mkdir, readdir, copyFile, lstat, access } from 'node:fs/promises'
import { resolve, dirname, relative, isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { gzipSync } from 'node:zlib'

const plugin = dirname(fileURLToPath(import.meta.url))
const repo = resolve(plugin, '../..')
const output = process.argv[2] && resolve(process.argv[2])
if (!output || output === resolve(plugin, 'runtime')) throw new Error('Specify a separate, empty release output directory')
await mkdir(output, { recursive: true })
if ((await readdir(output)).length) throw new Error('Release output directory must be empty')
const source = await readFile(resolve(plugin, 'src/update.ts'), 'utf8')
const version = source.match(/CURRENT_RELEASE_VERSION\s*=\s*['"](\d+\.\d+\.\d+)['"]/)?.[1]
if (!version) throw new Error('Release version missing')
const ids = ['pet', 'overview', 'notify', 'billing', 'wechat']
const owners = new Map(['core', ...ids].map(id => [id, []]))
const artifact = async (owner, root, path, from) => {
  const bytes = await readFile(from)
  const target = resolve(output, root, path)
  await mkdir(dirname(target), { recursive: true })
  if (resolve(from) !== target) await copyFile(from, target)
  owners.get(owner).push({ root, path, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') })
}
for (const id of ['manager', 'core', ...ids]) {
  await build({ cwd: repo, config: false, entry: { [id]: resolve(plugin, 'src', id === 'manager' ? 'runtime-host.ts' : id === 'core' ? 'runtime-core.ts' : 'features/' + id + '.ts') },
    outDir: resolve(output, 'host'), clean: false, format: 'esm', platform: 'node', target: 'node22', dts: false, sourcemap: false,
    // yaml is a plugin-local runtime dependency. The plugin directory is not a
    // workspace package, so leaving it external would make the installed host
    // bundle depend on a node_modules link that the release does not carry.
    deps: { neverBundle: id => id !== 'yaml' && id !== '@deepseek-ai/dsh-token-monitor-contract' && !id.startsWith('@deepseek-ai/dsh-token-monitor-contract/') && !id.startsWith('.') && !isAbsolute(id) }, outputOptions: { entryFileNames: '[name].mjs', codeSplitting: false } })
  await artifact(ids.includes(id) ? id : 'core', 'host', id + '.mjs', resolve(output, 'host', id + '.mjs'))
}

// Follow the current entry; old build chunks may still exist in lib.
// Static dependencies belong to their sole feature, or to core when shared.
const hasPath = async path => { try { await access(path); return true } catch { return false } }
// The public package build writes lib/; package-local lib may be stale.
const client = resolve(repo, 'lib')
const roots = new Map([
  ['client.js', 'core'], ['client.WhaleGirlStage.js', 'pet'], ['client.UsageDetailsWindow.js', 'overview'],
  ['client.TokenMonitorSettingsPanel.js', 'notify'],
  ['client.BillingRulesPanel.js', 'billing'],
  ['client.FeeExplanation.js', 'billing'], ['client.WechatLoginQr.js', 'wechat'],
])
const demands = new Map()
const visit = async (file, owner) => {
  const set = demands.get(file) ?? new Set()
  if (set.has(owner)) return
  set.add(owner); demands.set(file, set)
  const text = await readFile(resolve(client, file), 'utf8')
  for (const match of text.matchAll(/require\(["']\.\/([^"']+)["']\)/g)) await visit(match[1], owner)
  for (const match of text.matchAll(/require\.async\(["']\.\/([^"']+)["']\)/g)) {
    if (!roots.has(match[1])) throw new Error('Unclassified dynamic feature: ' + match[1])
    await visit(match[1], roots.get(match[1]))
  }
}
await visit('client.js', 'core')
// Anything left unvisited would be silently dropped from the manifest; report it instead.
const reached = new Set(demands.keys())
const unclassified = (await readdir(client)).filter(file => file.endsWith('.js') && !reached.has(file))
if (unclassified.length) console.log('unreferenced lib files (excluded): ' + unclassified.join(', '))
for (const [file, set] of demands) {
  const owner = set.size === 1 ? [...set][0] : 'core'
  await artifact(owner, 'client', file, resolve(client, file))
  try { await artifact(owner, 'client', file + '.map', resolve(client, file + '.map')) }
  catch (error) { if (error.code !== 'ENOENT') throw error }
}
const assets = await hasPath(resolve(repo, 'apps/web/public/assets/dsh-token-monitor'))
  ? resolve(repo, 'apps/web/public/assets/dsh-token-monitor')
  : resolve(repo, 'assets/dsh-token-monitor')
const walk = async directory => {
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const file = resolve(directory, item.name)
    if ((await lstat(file)).isSymbolicLink()) throw new Error('Asset links are not allowed')
    if (item.isDirectory()) await walk(file)
    else {
      const path = relative(assets, file).replaceAll('\\', '/')
      const owner = path.startsWith('whale-girl/') ? 'pet' : path.startsWith('settings-ui/cute/') ? 'core' : undefined
      if (!owner) throw new Error('Unclassified asset: ' + path)
      await artifact(owner, 'assets', path, file)
    }
  }
}
await walk(assets)
for (const files of owners.values()) files.sort((a, b) => (a.root + '/' + a.path).localeCompare(b.root + '/' + b.path))
const manifest = { schemaVersion: 1, version, core: owners.get('core'), modules: ids.map(id => ({ id, files: owners.get(id) })) }
await writeFile(resolve(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
// Release packaging is explicit and separate from runtime; these are never local restore caches.
if (process.argv.includes('--packs')) {
  await mkdir(resolve(output, 'release-assets'))
  await copyFile(resolve(output, 'manifest.json'), resolve(output, 'release-assets', 'token-monitor-' + version + '.manifest.json'))
  for (const [owner, files] of owners) {
    const pack = { schemaVersion: 1, files: await Promise.all(files.map(async file => ({ key: file.root + '/' + file.path, data: (await readFile(resolve(output, file.root, file.path))).toString('base64') }))) }
    await writeFile(resolve(output, 'release-assets', 'token-monitor-' + version + '.' + owner + '.json.gz'), gzipSync(JSON.stringify(pack)))
  }
}
console.log(JSON.stringify({ output, version, owners: Object.fromEntries([...owners].map(([id, files]) => [id, { files: files.length, bytes: files.reduce((sum, file) => sum + file.size, 0) }])) }, null, 2))
