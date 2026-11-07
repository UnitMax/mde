import { promises as fs } from 'node:fs'
import { dirname } from 'node:path'

/**
 * Replaces `target` with `contents`, text exactly as given. The contents are flushed to a temporary file
 * beside the target first and then renamed over it, so a crash leaves either the old file or the new one, never
 * a partial write. `mode`, when given, is the permission the new file gets (an existing file's mode is passed
 * on this way); a file system that cannot set it is not an error.
 */
export async function writeTextAtomic(target: string, contents: string, mode?: number): Promise<void> {
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`

  await fs.mkdir(dirname(target), { recursive: true })
  const handle = await fs.open(tmp, 'w', mode)
  try {
    if (mode !== undefined) await handle.chmod(mode).catch(() => undefined)
    await handle.writeFile(contents, 'utf8')
    await handle.sync()
  } finally {
    await handle.close()
  }
  try {
    await fs.rename(tmp, target)
  } catch (error) {
    await fs.rm(tmp, { force: true })
    throw error
  }
}

/**
 * Replaces `target` with `value` as pretty JSON, written the same atomic way.
 */
export async function writeJsonAtomic(target: string, value: unknown): Promise<void> {
  await writeTextAtomic(target, `${JSON.stringify(value, null, 2)}\n`)
}
