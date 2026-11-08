import { promises as fs } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readContainedFile } from '../src/main/files/read'

describe.skipIf(process.platform !== 'linux')('contained descriptor reads', () => {
  let base: string
  let root: string
  beforeEach(async () => {
    base = await fs.mkdtemp(join(tmpdir(), 'mde-contained-'))
    root = join(base, 'root')
    await fs.mkdir(join(root, 'sub'), { recursive: true })
    await fs.mkdir(join(base, 'outside'))
    await fs.writeFile(join(root, 'sub', 'file'), 'inside')
    await fs.writeFile(join(base, 'outside', 'file'), 'outside-secret')
  })
  afterEach(async () => { vi.restoreAllMocks(); await fs.rm(base, { recursive: true, force: true }) })

  it('rejects FIFOs without waiting for a writer', async () => {
    execFileSync('mkfifo', [join(root, 'fifo')])
    await expect(readContainedFile(root, 'fifo', 100)).rejects.toThrow('Not a file.')
    expect((await readContainedFile(root, 'sub/file', 100)).bytes?.toString()).toBe('inside')
  })

  it('rejects an ancestor replaced between validation and open', async () => {
    const open = fs.open.bind(fs)
    vi.spyOn(fs, 'open').mockImplementation(async (path, flags, mode) => {
      if (path === join(root, 'sub', 'file')) {
        await fs.rename(join(root, 'sub'), join(root, 'old-sub'))
        await fs.symlink(join(base, 'outside'), join(root, 'sub'))
      }
      return open(path, flags, mode)
    })
    await expect(readContainedFile(root, 'sub/file', 100)).rejects.toThrow('outside the session')
  })

  it('rejects a final file replaced with a symlink before open', async () => {
    const open = fs.open.bind(fs)
    vi.spyOn(fs, 'open').mockImplementation(async (path, flags, mode) => {
      await fs.unlink(path)
      await fs.symlink(join(base, 'outside', 'file'), path)
      return open(path, flags, mode)
    })
    await expect(readContainedFile(root, 'sub/file', 100)).rejects.toThrow()
  })
})
