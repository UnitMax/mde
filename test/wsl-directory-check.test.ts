import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { directoryCheckArgs } from '../src/main/wsl/paths'

const run = promisify(execFile)

/**
 * `wsl.exe -e` runs these arguments directly, with no shell, so the argv this
 * builds is what the distro's `test` receives verbatim. Running the real binary
 * here is the only check that catches an argv `test` rejects outright — a
 * mocked runWslCommand accepts any shape and reports success.
 */
async function checkDirectory(path: string): Promise<number> {
  const [command, ...args] = directoryCheckArgs(path)
  try {
    await run(`/usr/bin/${command}`, args)
    return 0
  } catch (error) {
    return (error as { code?: number }).code ?? 1
  }
}

describe.skipIf(process.platform === 'win32')('in-distro directory check argv', () => {
  let directory = ''

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'mde-dircheck-'))
    await writeFile(join(directory, 'payload.exe'), 'not a directory')
  })

  afterAll(async () => {
    if (directory) await rm(directory, { recursive: true, force: true })
  })

  it('succeeds for a real directory', async () => {
    await expect(checkDirectory(directory)).resolves.toBe(0)
  })

  it('fails for a file, which is the spoofed OSC 7 case', async () => {
    await expect(checkDirectory(join(directory, 'payload.exe'))).resolves.not.toBe(0)
  })

  it('fails for a path that does not exist', async () => {
    await expect(checkDirectory(join(directory, 'missing'))).resolves.not.toBe(0)
  })

  it('handles a directory name that begins with a dash', async () => {
    const dashed = join(directory, '-d')
    await run('/usr/bin/mkdir', [dashed])
    await expect(checkDirectory(dashed)).resolves.toBe(0)
  })

  it('handles shell metacharacters in a directory name', async () => {
    const hostile = join(directory, 'a b; $(touch sentinel) `touch sentinel`')
    await run('/usr/bin/mkdir', [hostile])
    await expect(checkDirectory(hostile)).resolves.toBe(0)
    await expect(checkDirectory(join(directory, 'sentinel'))).resolves.not.toBe(0)
  })
})
