import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { runLaunchProcess } from './helpers/launch-process'

it.skipIf(process.platform === 'win32')('runs an interactive shell without a controlling terminal', async () => {
  const result = await runLaunchProcess('/bin/sh', [
    '-c',
    'if (: </dev/tty) 2>/dev/null; then exit 1; fi; read -r value; printf "%s" "$value"',
  ], { input: 'fixture input\n' })

  expect(result.status).toBe(0)
  expect(result.stdout).toBe('fixture input')
})

it.skipIf(process.platform !== 'linux')('kills descendants when a shell ignores the timeout shutdown signal', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'mde-launch-timeout-'))
  const pidFile = join(directory, 'child.pid')
  try {
    await expect(runLaunchProcess('/bin/sh', [
      '-c',
      'trap "" TERM; sleep 60 & child=$!; printf "%s" "$child" > "$1"; wait',
      'fixture',
      pidFile,
    ], { timeout: 500 })).rejects.toThrow('Launch test process exceeded 500 ms')

    const pid = readFileSync(pidFile, 'utf8')
    try {
      // A killed descendant may briefly remain a zombie until its new parent reaps it.
      const status = readFileSync(`/proc/${pid}/stat`, 'utf8')
      expect(status.slice(status.lastIndexOf(')') + 2).split(' ')[0]).toBe('Z')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
