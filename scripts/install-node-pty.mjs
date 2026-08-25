import { spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)))

export function installNodePty({
  platform = process.platform,
  rootDirectory = projectRoot,
  spawn = spawnSync,
} = {}) {
  if (platform === 'win32') {
    console.log('Using node-pty Windows prebuilt binaries; native rebuild skipped.')
    return 0
  }

  const executable = join(rootDirectory, 'node_modules', '.bin', 'electron-rebuild')
  const result = spawn(executable, ['--force', '--only', 'node-pty'], {
    cwd: rootDirectory,
    stdio: 'inherit',
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`electron-rebuild failed with exit code ${result.status ?? 'unknown'}`)
  }
  return result.status
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null
if (invokedPath === fileURLToPath(import.meta.url)) installNodePty()
