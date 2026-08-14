import { execFile } from 'node:child_process'
import type { Distro } from '@shared/types'

/**
 * `wsl.exe` emits UTF-16LE unless WSL_UTF8 is set in its environment. Every
 * invocation in this app goes through here so that can never be forgotten.
 */
export function wslEnv(): NodeJS.ProcessEnv {
  return { ...process.env, WSL_UTF8: '1' }
}

export interface WslResult {
  stdout: string
  stderr: string
  code: number
}

/** Runs wsl.exe and resolves with the exit code instead of throwing on non-zero. */
export function runWsl(args: string[], timeoutMs = 15_000): Promise<WslResult> {
  return new Promise((resolve) => {
    execFile(
      'wsl.exe',
      args,
      { env: wslEnv(), encoding: 'buffer', timeout: timeoutMs, windowsHide: true },
      (error, stdout, stderr) => {
        const err = error as (NodeJS.ErrnoException & { code?: number | string }) | null
        let code = 0
        if (err) code = typeof err.code === 'number' ? err.code : 1
        resolve({ stdout: decodeWslOutput(stdout), stderr: decodeWslOutput(stderr), code })
      }
    )
  })
}

/**
 * Decodes wsl.exe output as UTF-8. WSL_UTF8=1 is always set, so this is the
 * normal path. If a build of wsl.exe ignores the variable the bytes come back
 * UTF-16LE, which decoded as UTF-8 looks plausible but is riddled with NULs and
 * silently breaks every string comparison downstream. Detect that and decode
 * properly rather than papering over it by stripping the NULs.
 */
export function decodeWslOutput(buffer: Buffer): string {
  const utf8 = buffer.toString('utf8')
  if (!utf8.includes('\u0000')) return utf8

  console.warn('[wsl] wsl.exe ignored WSL_UTF8=1 and returned UTF-16LE; decoding as UTF-16LE')
  return buffer.toString('utf16le').replace(/^\uFEFF/, '')
}

/**
 * Parses `wsl.exe --list --verbose`:
 *
 *     NAME            STATE           VERSION
 *   * Ubuntu-24.04    Running         2
 *     docker-desktop  Stopped         2
 *
 * Columns are space-padded, so two or more spaces is a reliable separator and
 * the header row falls out naturally (its VERSION column is not a number).
 */
export function parseDistroList(output: string): Distro[] {
  const distros: Distro[] = []

  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) continue

    const isDefault = line.startsWith('*')
    const body = (isDefault ? line.slice(1) : line).trim()

    const match =
      /^(.+?)\s{2,}(.+?)\s{2,}(\d+)$/.exec(body) ?? /^(\S+)\s+(\S+)\s+(\d+)$/.exec(body)
    if (!match) continue

    const [, name, state, version] = match
    if (!name || !state || !version) continue

    distros.push({ name, state, version: Number(version), isDefault })
  }

  return distros
}

let availability: Promise<boolean> | null = null

/** True only on Windows with a working wsl.exe. Cached; the answer cannot change mid-session. */
export function isWslAvailable(): Promise<boolean> {
  if (process.platform !== 'win32') return Promise.resolve(false)
  if (!availability) {
    availability = runWsl(['--status'])
      .then((result) => result.code === 0)
      .catch(() => false)
  }
  return availability
}

/** WSL 2 distros only. Returns [] when WSL is unavailable rather than throwing. */
export async function listDistros(): Promise<Distro[]> {
  if (!(await isWslAvailable())) return []

  const result = await runWsl(['--list', '--verbose'])
  if (result.code !== 0) {
    console.warn(`[wsl] --list --verbose exited ${result.code}: ${result.stderr.trim()}`)
    return []
  }

  return parseDistroList(result.stdout).filter((distro) => distro.version === 2)
}
