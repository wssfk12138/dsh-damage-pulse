/** One OS-owned listener excludes competing runtimes; process exit releases it. */
import { createServer } from 'node:net'
import { createHash } from 'node:crypto'
import { lstat, readFile, unlink } from 'node:fs/promises'
import { resolve } from 'node:path'

/** Acquire before reading, recovering or importing release bytes; caller disposes on shutdown. */
export async function acquireModuleLease(stateFile: string): Promise<() => Promise<void>> {
  const identity = process.platform === 'win32' ? resolve(stateFile).toLowerCase() : resolve(stateFile)
  const hash = createHash('sha256').update(identity).digest('hex')
  const server = createServer(socket => socket.destroy())
  await new Promise<void>((accept, reject) => {
    server.once('error', () => reject(new Error('MODULE_RUNTIME_ALREADY_ACTIVE')))
    if (process.platform === 'win32') server.listen(`\\\\.\\pipe\\dsh-token-monitor-${hash}`, accept)
    else server.listen({ host: '127.0.0.1', port: 40000 + parseInt(hash.slice(0, 4), 16) % 20000, exclusive: true }, accept)
  })
  server.unref()
  return () => new Promise<void>((accept, reject) => server.close(error => error ? reject(error) : accept()))
}

/** Only the exclusive runtime may recover an operation lock whose recorded process is dead. */
export async function recoverModuleLock(stateFile: string): Promise<void> {
  const lock = `${stateFile}.lock`
  let owner: string
  try {
    const stat = await lstat(lock)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 32) throw new Error('MODULE_LOCK_RECOVERY_REQUIRED')
    owner = await readFile(lock, 'utf8')
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error }
  if (!/^[1-9][0-9]*\n$/.test(owner)) throw new Error('MODULE_LOCK_RECOVERY_REQUIRED')
  try { process.kill(Number(owner.trim()), 0) }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') { await unlink(lock); return }
    throw new Error('MODULE_LOCK_RECOVERY_REQUIRED')
  }
  throw new Error('MODULE_LOCK_OWNER_ACTIVE')
}
