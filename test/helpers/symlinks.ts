import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Whether this account may create symbolic links. Windows allows it only to administrators or with Developer
 * Mode, so a test that needs a link must not fail there for that reason: it checks this and skips the link.
 */
export const canCreateSymlinks: boolean = (() => {
  const directory = mkdtempSync(join(tmpdir(), 'mde-symlink-probe-'))
  try {
    writeFileSync(join(directory, 'target'), '')
    symlinkSync(join(directory, 'target'), join(directory, 'link'))
    return true
  } catch {
    return false
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})()
