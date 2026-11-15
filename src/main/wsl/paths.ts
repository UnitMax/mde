import type { PathResolution } from '@shared/types'
import { runWslCommand } from './distros'

/** e.g. \\wsl$\Ubuntu-24.04\home\me\src or \\wsl.localhost\Ubuntu-24.04\home\me\src */
const WSL_UNC = /^\\\\wsl(?:\$|\.localhost)\\([^\\/]+)((?:[\\/].*)?)$/i

/** C0 and C1 controls, including DEL. */
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/

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
  '  "~/"*) input="$HOME/${input:2}" ;;',
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
 *
 * -e (--exec), never --: wsl.exe hands everything after `--` to the distro's
 * default shell, which re-parses it and eats the script's `;;` and quoting.
 */
export async function canonicalizeWslPath(distro: string, rawPath: string): Promise<string | null> {
  // Not a login shell: `wsl.exe -e` already sets HOME, and reading the person's profile on every
  // call costs more than the round trip itself.
  const result = await runWslCommand(distro, [
    'bash',
    '-c',
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

const CANONICAL_WSL_DIRECTORY_SCRIPT = [
  'resolved=$(realpath -- "$1" 2>/dev/null) || resolved=$1',
  '[ -d "$resolved" ] || exit 3',
  'printf "%s\\n" "$resolved"'
].join('\n')

const directoryChecks = new Map<string, Promise<string | null>>()

/**
 * The real path of a folder inside the distro, or null when it is not a folder there: `realpath`
 * and the `test -d` of `directoryCheckArgs` in one round trip. A path `realpath` cannot resolve is
 * checked as it was given. The answer is distro-side data, so the caller checks its shape again.
 *
 * Nothing is remembered between calls, but callers asking about the same folder at the same moment
 * (a file tree reloading every open folder) share one round trip.
 */
export function canonicalWslDirectory(distro: string, path: string): Promise<string | null> {
  const key = `${distro}\0${path}`
  const running = directoryChecks.get(key)
  if (running) return running
  const check = runWslCommand(distro, ['bash', '-c', CANONICAL_WSL_DIRECTORY_SCRIPT, 'mde-directory', path])
    .then((result) => {
      const resolved = result.stdout.trim()
      return result.code === 0 && resolved ? resolved : null
    })
    .finally(() => { directoryChecks.delete(key) })
  directoryChecks.set(key, check)
  return check
}

/** `wsl.exe -d <distro> -e wslpath -u <windowsPath>` */
export async function toWsl(distro: string, windowsPath: string): Promise<string | null> {
  const result = await runWslCommand(distro, [
    'wslpath',
    '-u',
    stripTrailingSeparators(windowsPath)
  ])
  if (result.code !== 0) {
    console.warn(`[wsl] wslpath -u failed for ${windowsPath}: ${result.stderr.trim()}`)
    return null
  }
  const out = result.stdout.trim()
  return out.length > 0 ? out : null
}

/** `wsl.exe -d <distro> -e wslpath -w <linuxPath>` */
export async function toWindows(distro: string, linuxPath: string): Promise<string | null> {
  const result = await runWslCommand(distro, ['wslpath', '-w', linuxPath])
  if (result.code !== 0) {
    console.warn(`[wsl] wslpath -w failed for ${linuxPath}: ${result.stderr.trim()}`)
    return null
  }
  const out = result.stdout.trim()
  return out.length > 0 ? out : null
}

/**
 * True for an ordinary absolute Linux path: no controls, no backslash, and no
 * relative segment. Paths that reach the Windows side are pasted into UNC and
 * URI strings where a backslash is a separator and `..` climbs, so a name
 * containing either has to be rejected before that translation, not after.
 */
export function isPlainAbsolutePath(input: string): boolean {
  if (!input.startsWith('/')) return false
  if (input.includes('\\') || CONTROL_CHARS.test(input)) return false
  return !input.split('/').some((segment) => segment === '.' || segment === '..')
}

/**
 * argv for an in-distro "is this still a directory" check.
 *
 * Exactly two operands. `test` is not getopt-based, so a `--` terminator would
 * be a third operand and the expression would fail for every path; two operands
 * always parse as a unary operator applied to the path, which makes a leading
 * dash in a directory name unambiguous. Nothing quotes or splits these — they
 * are passed through `wsl.exe -e`, which does not involve a shell.
 */
export function directoryCheckArgs(path: string): string[] {
  return ['test', '-d', path]
}

/**
 * Fallback used when wslpath cannot run (distro stopped, wsl.exe missing).
 * Callers translating a path that came from terminal output must check it with
 * `isPlainAbsolutePath` first: a backslash or `..` in a Linux name becomes a
 * separator here.
 */
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
