import { constants, promises as fs } from 'node:fs'
import { join, sep } from 'node:path'
import { readWindowsContainedFile } from './windows-read'

function inside(root: string, path: string): boolean {
  return path.startsWith(root.endsWith(sep) ? root : root + sep)
}

/** Bounded regular-file read shared by previews and copied attachments. */
export async function readContainedFile(rootPath: string, relative: string, limit: number): Promise<{ size: number; bytes: Buffer | null }> {
  if (process.platform === 'win32' && relative.split('/').some((part) =>
    /[<>:"|?*]|[. ]$/.test(part) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) {
    throw new Error('Invalid file path.')
  }
  const root = await fs.realpath(rootPath)
  const path = await fs.realpath(join(root, ...relative.split('/')))
  if (!inside(root, path)) throw new Error('File is outside the session folder.')
  if (process.platform === 'win32') {
    // A folder is refused plainly, not reported as a failed safe open; the native reader still checks what it opens.
    if ((await fs.stat(path)).isDirectory()) throw new Error('Not a file.')
    return readWindowsContainedFile(root, path, limit)
  }
  if (!(await fs.lstat(path)).isFile()) throw new Error('Not a file.')
  const flags = constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW
  const handle = await fs.open(path, flags)
  try {
    const stat = await handle.stat()
    if (!stat.isFile()) throw new Error('Not a file.')
    const verify = async (): Promise<void> => {
      // Linux (including WSL) exposes the actual opened object, so a replaced
      // ancestor cannot turn a previously validated pathname into outside data.
      const opened = await fs.realpath(process.platform === 'linux' ? `/proc/self/fd/${handle.fd}` : path)
      if (!inside(root, opened)) throw new Error('File is outside the session folder.')
      const current = await fs.stat(opened)
      if (current.dev !== stat.dev || current.ino !== stat.ino) throw new Error('The file changed while opening. Try again.')
    }
    await verify()
    if (stat.size > limit) return { size: stat.size, bytes: null }
    const bytes = Buffer.alloc(limit + 1)
    let length = 0
    while (length < bytes.length) {
      const result = await handle.read(bytes, length, bytes.length - length, length)
      if (!result.bytesRead) break
      length += result.bytesRead
    }
    await verify()
    return { size: Math.max(stat.size, length), bytes: bytes.subarray(0, length) }
  } finally { await handle.close() }
}
