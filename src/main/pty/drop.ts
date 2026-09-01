import { stat } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import type {
  DropPtyFile,
  PtyDropRejection,
  PtyDropResult,
  TerminalDropMode,
  TerminalDropRejectionCode
} from '@shared/ipc'
import type { Session } from '@shared/types'
import { runWslCommand } from '../wsl/distros'
import { isWindowsDrivePath, parseWslUncPath, toWsl } from '../wsl/paths'

export type TerminalDropShell = 'posix' | 'powershell' | 'cmd'
export type TerminalDropResult = PtyDropResult

const unsafePathCharacters = /[\u0000-\u001f\u007f]/

function shellBasename(shell: string): string {
  const normalised = shell.replaceAll('\\', '/')
  return (normalised.split('/').pop() ?? normalised).toLowerCase()
}

/** Selects the quoting rules used by the terminal's target shell. */
export function terminalDropShell(session: Session, platform: NodeJS.Platform): TerminalDropShell {
  if (session.kind === 'wsl' || platform !== 'win32') return 'posix'

  const shell = shellBasename(session.shell ?? 'powershell.exe')
  if (shell === 'cmd' || shell === 'cmd.exe') return 'cmd'
  if (
    shell === 'bash' ||
    shell === 'bash.exe' ||
    shell === 'dash' ||
    shell === 'dash.exe' ||
    shell === 'fish' ||
    shell === 'fish.exe' ||
    shell === 'ksh' ||
    shell === 'ksh.exe' ||
    shell === 'sh' ||
    shell === 'sh.exe' ||
    shell === 'zsh' ||
    shell === 'zsh.exe'
  ) {
    return 'posix'
  }
  return 'powershell'
}

export function quoteDroppedPath(path: string, shell: TerminalDropShell): string {
  if (shell === 'posix') return `'${path.replaceAll("'", "'\\''")}'`
  if (shell === 'powershell') return `'${path.replaceAll("'", "''")}'`
  return `"${path.replaceAll('"', '""')}"`
}

/** Formats paths as one shell-safe, bracketed-paste-friendly insertion. */
export function formatTerminalDrop(paths: readonly string[], shell: TerminalDropShell): string {
  if (paths.length === 0) return ''
  return `${paths.map((path) => quoteDroppedPath(path, shell)).join(' ')} `
}

export interface AgentDropInsertions {
  insertions: string[]
  /** How many paths had to be quoted despite TUI mode. */
  quotedForSafety: number
}

/**
 * Formats each path separately so an agent TUI can detect spaces as one path.
 *
 * A path the target shell would act on is quoted even here. Nothing at this
 * layer can tell an agent TUI apart from a shell prompt drawing in the
 * alternate buffer, so the text has to be inert either way. The quotes are
 * visible inside a TUI, which is a cosmetic cost paid only by the hostile
 * filenames that make it necessary.
 */
export function formatAgentDrop(
  paths: readonly string[],
  shell: TerminalDropShell
): AgentDropInsertions {
  let quotedForSafety = 0
  const insertions = paths.map((path) => {
    if (isShellInertPath(path, shell)) return `${path} `
    quotedForSafety += 1
    return `${quoteDroppedPath(path, shell)} `
  })
  return { insertions, quotedForSafety }
}

export function isSafeDroppedPath(path: string): boolean {
  return path.length > 0 && !unsafePathCharacters.test(path)
}

/**
 * Characters each shell acts on rather than treating as ordinary path text.
 *
 * A space is deliberately absent: it cannot inject anything, and passing spaces
 * through unquoted is the entire reason `formatAgentDrop` exists. Word-splitting
 * is a correctness concern for the shell branch, which quotes everything anyway.
 */
const shellActiveCharacters: Record<TerminalDropShell, RegExp> = {
  posix: /[`$();&|<>'"\\*?[\]{}~!#\n\r]/,
  powershell: /[`$();&|<>'"{}[\]@,#\n\r]/,
  cmd: /[%!^&|<>();'"\n\r]/
}

/**
 * True when a path would mean nothing but itself to the target shell.
 *
 * Whether a pane is "really" a TUI cannot be known from here — terminal output
 * controls alternate-screen state, so a program can leave a real shell prompt
 * drawing in the alternate buffer. Classifying the *path* instead of the pane
 * removes the need to know: inert text is inert wherever it lands.
 */
export function isShellInertPath(path: string, shell: TerminalDropShell): boolean {
  return isSafeDroppedPath(path) && !shellActiveCharacters[shell].test(path)
}

/** Converts a browser file URL into a host-native path without accepting other URL schemes. */
export function fileUriToNativePath(uri: string, platform: NodeJS.Platform): string | null {
  let url: URL
  try {
    url = new URL(uri)
  } catch {
    return null
  }

  if (url.protocol.toLowerCase() !== 'file:') return null

  try {
    if (platform === 'win32') {
      const decodedPath = decodeURIComponent(url.pathname)
      const windowsPath = decodedPath.replaceAll('/', '\\')
      if (url.hostname && url.hostname.toLowerCase() !== 'localhost') {
        return `\\\\${url.hostname}${windowsPath.startsWith('\\') ? '' : '\\'}${windowsPath}`
      }
      return /^[\\/]?[A-Za-z]:[\\/]/.test(decodedPath)
        ? windowsPath.replace(/^\\/, '')
        : windowsPath
    }

    if (url.hostname && url.hostname.toLowerCase() !== 'localhost') return null
    return fileURLToPath(url)
  } catch {
    return null
  }
}

function isWindowsUncPath(path: string): boolean {
  return path.startsWith('\\\\')
}

function isNativePath(path: string, platform: NodeJS.Platform): boolean {
  if (platform === 'win32') return isWindowsDrivePath(path) || isWindowsUncPath(path)
  return (platform === 'linux' || platform === 'darwin') && path.startsWith('/')
}

async function nativePathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

interface WslPathCheck {
  exists: boolean
  unavailable: boolean
}

async function wslPathExists(distro: string, path: string): Promise<WslPathCheck> {
  const result = await runWslCommand(distro, ['test', '-e', path])
  return {
    exists: result.code === 0,
    unavailable: result.code !== 0 && result.stderr.trim().length > 0
  }
}

interface DropPathResolution {
  path?: string
  rejection?: {
    code: TerminalDropRejectionCode
    distro?: string
  }
}

function rejected(code: TerminalDropRejectionCode, distro?: string): DropPathResolution {
  return { rejection: { code, distro } }
}

function sourcePath(file: DropPtyFile, platform: NodeJS.Platform): string | null {
  if (file.nativePath) return file.nativePath
  if (file.fileUri) return fileUriToNativePath(file.fileUri, platform)
  return null
}

async function resolveDroppedPath(
  session: Session,
  platform: NodeJS.Platform,
  file: DropPtyFile
): Promise<DropPathResolution> {
  const rawPath = sourcePath(file, platform)
  if (!rawPath) return rejected('path-unresolved')
  if (!isSafeDroppedPath(rawPath)) return rejected('invalid-path')

  if (session.kind === 'native') {
    if (!isNativePath(rawPath, platform)) return rejected('invalid-path')
    return (await nativePathExists(rawPath))
      ? { path: rawPath }
      : rejected('inaccessible')
  }

  if (platform !== 'win32' || !session.distro) return rejected('wsl-unavailable')

  const unc = parseWslUncPath(rawPath)
  let targetPath: string | null
  if (unc) {
    if (unc.distro.toLowerCase() !== session.distro.toLowerCase()) {
      return rejected('wrong-distro', session.distro)
    }
    targetPath = unc.path
  } else if (rawPath.startsWith('/')) {
    targetPath = rawPath
  } else if (isWindowsDrivePath(rawPath) || isWindowsUncPath(rawPath)) {
    targetPath = await toWsl(session.distro, rawPath)
    if (!targetPath) return rejected('translation-failed', session.distro)
  } else {
    return rejected('invalid-path', session.distro)
  }

  if (!targetPath || !targetPath.startsWith('/') || !isSafeDroppedPath(targetPath)) {
    return rejected('invalid-path', session.distro)
  }

  const check = await wslPathExists(session.distro, targetPath)
  if (check.unavailable) return rejected('wsl-unavailable', session.distro)
  return check.exists
    ? { path: targetPath }
    : rejected('inaccessible', session.distro)
}

function rejectionFor(file: DropPtyFile, result: DropPathResolution): PtyDropRejection {
  return {
    name: file.name || 'Dropped file',
    code: result.rejection?.code ?? 'invalid-path',
    ...(result.rejection?.distro ? { distro: result.rejection.distro } : {})
  }
}

/** Resolves native drag paths into the session target and formats accepted paths. */
export async function resolveTerminalDrop(
  session: Session,
  platform: NodeJS.Platform,
  files: readonly DropPtyFile[],
  mode: TerminalDropMode
): Promise<TerminalDropResult> {
  const resolutions = await Promise.all(
    files.map((file) => resolveDroppedPath(session, platform, file))
  )
  const acceptedPaths: string[] = []
  const rejections: PtyDropRejection[] = []

  resolutions.forEach((resolution, index) => {
    const file = files[index]
    if (!file) return
    if (resolution.path) acceptedPaths.push(resolution.path)
    else rejections.push(rejectionFor(file, resolution))
  })

  const shell = terminalDropShell(session, platform)

  if (mode === 'tui') {
    const agent = formatAgentDrop(acceptedPaths, shell)
    return {
      insertions: agent.insertions,
      acceptedCount: acceptedPaths.length,
      rejections,
      ...(agent.quotedForSafety > 0 ? { quotedForSafety: agent.quotedForSafety } : {})
    }
  }

  return {
    insertions: acceptedPaths.length > 0 ? [formatTerminalDrop(acceptedPaths, shell)] : [],
    acceptedCount: acceptedPaths.length,
    rejections
  }
}
