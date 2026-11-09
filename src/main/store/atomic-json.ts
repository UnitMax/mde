import { promises as fs } from 'node:fs'
import { dirname } from 'node:path'

/** How long to wait before each further try at a rename that Windows refused, in milliseconds. */
export const RENAME_RETRY_DELAYS = [20, 60, 150, 300]
const BUSY = new Set(['EPERM', 'EACCES', 'EBUSY'])

/**
 * Renames `from` over `to`. On Windows the rename is refused while another program, typically a
 * security scanner or an indexer, has either file open, which lasts a few milliseconds; so a refusal
 * of that kind is tried again a few times before it counts as a failure.
 */
export async function renameOver(
  from: string,
  to: string,
  rename: (from: string, to: string) => Promise<void> = fs.rename,
  delays: readonly number[] = RENAME_RETRY_DELAYS,
): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await rename(from, to)
    } catch (error) {
      const delay = delays[attempt]
      if (delay === undefined || !BUSY.has((error as NodeJS.ErrnoException).code ?? '')) throw error
      await new Promise((resolve) => setTimeout(resolve, delay))
    }
  }
}

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
    await renameOver(tmp, target)
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
