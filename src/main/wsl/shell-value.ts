import { runWsl, type WslResult } from './distros'

/**
 * Reading a single value out of a distro is deceptively hard. A login shell is
 * needed so the user's own environment applies, but rc files are free to print
 * banners, version-manager chatter, and prompt-tool init to stdout, and all of
 * that lands ahead of the value. Wrapping the value in markers and extracting
 * only what sits between them makes the probe immune to whatever else the shell
 * decides to say.
 */
export const WSL_VALUE_BEGIN = '__MDE_VALUE_BEGIN__'
export const WSL_VALUE_END = '__MDE_VALUE_END__'

export interface WslValueResult {
  value: string | null
  /** Short single-line excerpt of what the distro actually returned. */
  detail: string
}

/**
 * Builds the script run inside the distro. `expression` is shell source that
 * produces the value, e.g. `"$HOME"`.
 */
export function wslShellValueScript(expression: string): string {
  return [
    `mde_value=${expression}`,
    `printf '\\n%s%s%s\\n' '${WSL_VALUE_BEGIN}' "$mde_value" '${WSL_VALUE_END}'`
  ].join('\n')
}

/**
 * Pulls the value out of raw shell output. The last marker pair wins, so a
 * shell that echoes its own command line back cannot shadow the real value.
 */
export function extractWslShellValue(stdout: string): string | null {
  const text = stdout.replace(/^﻿/, '')
  const begin = text.lastIndexOf(WSL_VALUE_BEGIN)
  if (begin === -1) return null

  const valueStart = begin + WSL_VALUE_BEGIN.length
  const end = text.indexOf(WSL_VALUE_END, valueStart)
  if (end === -1) return null

  return text.slice(valueStart, end)
}

/** Collapses command output into one short line suitable for an error message. */
export function describeWslOutput(result: WslResult): string {
  const combined = `${result.stdout} ${result.stderr}`.replace(/\s+/g, ' ').trim()
  if (combined.length === 0) return 'no output'
  return combined.length > 120 ? `${combined.slice(0, 117)}...` : combined
}

/**
 * Validates a path the distro reported. Deliberately permissive about the
 * characters a home directory may contain — spaces and non-ASCII are legal
 * Linux path text — and strict only about what would break downstream: a
 * relative path, or embedded line breaks and NULs that signal parse failure.
 */
export function assertWslLinuxPath(value: string, label: string): string {
  const path = value.trim()
  if (!path.startsWith('/') || /[\n\r\0]/.test(path)) {
    throw new Error(`WSL returned an invalid ${label}: "${describeValue(path)}".`)
  }
  return path.replace(/\/+$/, '') || '/'
}

function describeValue(value: string): string {
  const single = value.replace(/\s+/g, ' ').trim()
  return single.length > 80 ? `${single.slice(0, 77)}...` : single
}

/**
 * Reads one shell value from a distro. Tries an interactive login shell first
 * so variables the user only exports from `.bashrc` are honored, then retries
 * non-interactively when that produces nothing usable — an rc file that fails,
 * or hangs until runWsl's timeout, should not make the value unreadable.
 *
 * -e (--exec), never --: wsl.exe hands everything after `--` to the distro's
 * default shell, which re-parses it and eats the script's quoting.
 */
export async function readWslShellValue(
  distro: string,
  expression: string
): Promise<WslValueResult> {
  const script = wslShellValueScript(expression)
  let last: WslResult | null = null

  for (const shellArgs of ['-lic', '-lc']) {
    const result = await runWsl(['-d', distro, '-e', 'bash', shellArgs, script])
    last = result
    const value = extractWslShellValue(result.stdout)
    if (value !== null && value.trim().length > 0) return { value, detail: describeWslOutput(result) }
  }

  return { value: null, detail: last ? describeWslOutput(last) : 'no output' }
}
