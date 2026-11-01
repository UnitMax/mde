import { promises as fs } from 'node:fs'
import { dirname } from 'node:path'

/**
 * Replaces `target` with `value` as pretty JSON. The contents are flushed to a
 * temporary file first and then renamed over the target, so a crash leaves
 * either the old file or the new one, never a partial write.
 */
export async function writeJsonAtomic(target: string, value: unknown): Promise<void> {
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`
  const contents = `${JSON.stringify(value, null, 2)}\n`

  await fs.mkdir(dirname(target), { recursive: true })
  const handle = await fs.open(tmp, 'w')
  try {
    await handle.writeFile(contents, 'utf8')
    await handle.sync()
  } finally {
    await handle.close()
  }
  await fs.rename(tmp, target)
}
