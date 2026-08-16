import type { PathResolution } from '@shared/types'
import { runWsl } from './distros'

/** e.g. \\wsl$\Ubuntu-24.04\home\me\src or \\wsl.localhost\Ubuntu-24.04\home\me\src */
const WSL_UNC = /^\\\\wsl(?:\$|\.localhost)\\([^\\/]+)((?:[\\/].*)?)$/i

/** e.g. C:\src\app or C:/src/app */
const WINDOWS_DRIVE = /^[A-Za-z]:[\\/]/

export interface ParsedUncPath {
  distro: string
  /** Linux-side absolute path inside that distro. */
  path: string
}

/** Pure: recognises a UNC path into a WSL distro and splits it apart. */
export function parseWslUncPath(input: string): ParsedUncPath | null {
  const match = WSL_UNC.exec(input.trim())
  if (!match) return null

  const distro = match[1]
  if (!distro) return null

  const rest = (match[2] ?? '').replace(/\\/g, '/')
  const path = rest.length > 0 ? rest.replace(/\/+$/, '') : ''
  return { distro, path: path.length > 0 ? path : '/' }
}

/** Pure. */
export function isWindowsDrivePath(input: string): boolean {
  return WINDOWS_DRIVE.test(input.trim())
}

/** Pure: true for /mnt/<drive>/... paths, which cross the 9p boundary and are slow. */
export function isWslMountedWindowsPath(linuxPath: string): boolean {
  return /^\/mnt\/[a-z](\/|$)/i.test(linuxPath.trim())
}

export const SLOW_MOUNT_WARNING =
  'This folder lives on the Windows filesystem. Inside WSL it is reached over /mnt, ' +
  'which is significantly slower for agent workloads. Consider moving the repository ' +
  "into the distro's own filesystem (e.g. ~/src)."

function stripTrailingSeparators(input: string): string {
  // Keep a bare drive root ("C:\") intact; a trailing backslash there is meaningful.
  if (/^[A-Za-z]:[\\/]?$/.test(input)) return input
  return input.replace(/[\\/]+$/, '')
}

const CANONICALIZE_WSL_PATH_SCRIPT = [
  'input=$1',
  'case "$input" in',
  '  "~") input=$HOME ;;',
  '  "~/"*) input="$HOME/${input#~/}" ;;',
  'esac',
  'if resolved=$(realpath -- "$input" 2>/dev/null); then',
  '  printf "%s\\n" "$resolved"',
  'else',
  '  printf "%s\\n" "$input"',
  'fi'
].join('\n')

/**
 * Resolves WSL shorthand and existing symlinks without interpreting the path
 * through a shell. The path is passed as a positional argument to bash, so
 * spaces and shell metacharacters remain ordinary path text.
 */
export async function canonicalizeWslPath(distro: string, rawPath: string): Promise<string | null> {
  const result = await runWsl([
    '-d',
    distro,
    '--',
    'bash',
    '-lc',
    CANONICALIZE_WSL_PATH_SCRIPT,
    'mde-path',
    rawPath
  ])
  if (result.code !== 0) {
    console.warn(`[wsl] could not canonicalize path in ${distro}: ${result.stderr.trim()}`)
    return null
  }
  const path = result.stdout.trim()
  return path.length > 0 ? path : null
}

/** `wsl.exe -d <distro> wslpath -u <windowsPath>` */
export async function toWsl(distro: string, windowsPath: string): Promise<string | null> {
  const result = await runWsl(['-d', distro, 'wslpath', '-u', stripTrailingSeparators(windowsPath)])
  if (result.code !== 0) {
    console.warn(`[wsl] wslpath -u failed for ${windowsPath}: ${result.stderr.trim()}`)
    return null
  }
  const out = result.stdout.trim()
  return out.length > 0 ? out : null
}

/** `wsl.exe -d <distro> wslpath -w <linuxPath>` */
export async function toWindows(distro: string, linuxPath: string): Promise<string | null> {
  const result = await runWsl(['-d', distro, 'wslpath', '-w', linuxPath])
  if (result.code !== 0) {
    console.warn(`[wsl] wslpath -w failed for ${linuxPath}: ${result.stderr.trim()}`)
    return null
  }
  const out = result.stdout.trim()
  return out.length > 0 ? out : null
}

/** Fallback used when wslpath cannot run (distro stopped, wsl.exe missing). */
export function uncPathFor(distro: string, linuxPath: string): string {
  const windowsTail = linuxPath.replace(/\//g, '\\')
  return `\\\\wsl.localhost\\${distro}${windowsTail.startsWith('\\') ? '' : '\\'}${windowsTail}`
}

/**
 * Normalises whatever the user typed or picked into the format the target
 * stores. The stored path is always in the target's own format — this is the
 * only place a translation happens.
 */
export async function resolveForTarget(
  kind: 'native' | 'wsl',
  distro: string | undefined,
  rawPath: string
): Promise<PathResolution> {
  const input = rawPath.trim()
  if (!input) return { path: '' }

  if (kind === 'native') {
    // A UNC path into a distro is never a valid native project path.
    const unc = parseWslUncPath(input)
    if (unc) {
      return {
        path: input,
        warning: `This folder is inside the WSL distro "${unc.distro}". Choose WSL as the location instead.`
      }
    }
    return { path: stripTrailingSeparators(input) }
  }

  // kind === 'wsl'
  const unc = parseWslUncPath(input)
  if (unc) {
    // The picker landed inside a distro; take the distro name from the path itself.
    return { path: unc.path, distro: unc.distro }
  }

  if (isWindowsDrivePath(input)) {
    if (!distro) return { path: input }
    const converted = await toWsl(distro, input)
    if (!converted) {
      return {
        path: input,
        warning: `Could not translate "${input}" into a path inside "${distro}". Is the distro running?`
      }
    }
    return { path: converted, warning: SLOW_MOUNT_WARNING }
  }

  const path = stripTrailingSeparators(input)
  const canonical = distro ? await canonicalizeWslPath(distro, path) : null
  const resolvedPath = stripTrailingSeparators(canonical ?? path)
  return isWslMountedWindowsPath(resolvedPath)
    ? { path: resolvedPath, warning: SLOW_MOUNT_WARNING }
    : { path: resolvedPath }
}
