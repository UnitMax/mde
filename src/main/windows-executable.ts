import { realpathSync, statSync } from 'node:fs'
import { win32 } from 'node:path'

export interface HostExecutable {
  file: string
  /** Host-side working directory for short-lived commands and WSL PTYs. */
  cwd?: string
}

export interface WindowsExecutableDependencies {
  environment?: NodeJS.ProcessEnv
  canonicalize?: (path: string) => string
  readStats?: (path: string) => { isFile(): boolean }
}

/** Require a fully qualified drive path, excluding UNC/device paths and streams. */
export function assertWindowsExecutablePath(value: string, label = 'Windows executable'): string {
  if (
    !/^[A-Za-z]:[\\/]/.test(value) ||
    /[\u0000-\u001f\u007f-\u009f]/.test(value) ||
    /[:"<>|?*]/.test(value.slice(2)) ||
    value.slice(3).split(/[\\/]/).some((part) => part === '.' || part === '..')
  ) {
    throw new Error(`${label} must be a full Windows drive path without relative segments or streams.`)
  }
  return win32.normalize(value)
}

function inside(root: string, path: string): boolean {
  const relative = win32.relative(root.toLowerCase(), path.toLowerCase())
  return relative !== '' && relative !== '..' && !relative.startsWith('..\\') && !win32.isAbsolute(relative)
}

/**
 * Resolve only the requested executable, never searching cwd or PATH. Successful
 * resolutions are cached; missing WSL must not prevent native shells from opening.
 * The inherited SystemRoot and explicitly configured shell are trusted account
 * configuration, not a defense against a compromised launch environment/OS.
 */
export function createWindowsExecutableResolver(dependencies: WindowsExecutableDependencies = {}) {
  const canonicalize = dependencies.canonicalize ?? realpathSync
  const readStats = dependencies.readStats ?? statSync
  const executables = new Map<string, string>()
  let systemRoot: string | undefined

  const root = (): string => {
    if (systemRoot) return systemRoot
    const environment = dependencies.environment ?? process.env
    const key = Object.keys(environment).find((name) => name.toLowerCase() === 'systemroot')
    const value = key ? environment[key] : undefined
    if (!value) throw new Error('Windows SystemRoot is unavailable for trusted executable lookup.')
    const configured = assertWindowsExecutablePath(value, 'Windows SystemRoot')
    systemRoot = assertWindowsExecutablePath(canonicalize(configured), 'Windows SystemRoot')
    return systemRoot
  }

  const executable = (path: string, label: string, trustedRoot?: string): string => {
    const candidate = assertWindowsExecutablePath(path, label)
    let resolved = executables.get(candidate.toLowerCase())
    if (!resolved) {
      try {
        resolved = assertWindowsExecutablePath(canonicalize(candidate), label)
        if (!readStats(resolved).isFile()) throw new Error('Not a file')
      } catch {
        throw new Error(`${label} is unavailable. Check that it is installed at its configured location.`)
      }
    }
    if (trustedRoot && !inside(trustedRoot, resolved)) {
      throw new Error(`Refusing ${label} outside the Windows installation directory.`)
    }
    if (!/\.(?:exe|com)$/i.test(resolved)) {
      throw new Error(`${label} must be an .exe or .com program.`)
    }
    executables.set(candidate.toLowerCase(), resolved)
    return resolved
  }

  const systemExecutable = (relative: string, label: string): string => {
    const directory = root()
    return executable(win32.join(directory, relative), label, directory)
  }

  return {
    wsl(): HostExecutable {
      const file = systemExecutable('System32\\wsl.exe', 'Windows WSL executable')
      return { file, cwd: win32.dirname(file) }
    },
    shell(configured?: string): string {
      const shell = configured?.trim() || 'powershell.exe'
      switch (shell.toLowerCase()) {
        case 'powershell':
        case 'powershell.exe':
          return systemExecutable('System32\\WindowsPowerShell\\v1.0\\powershell.exe', 'Windows PowerShell')
        case 'cmd':
        case 'cmd.exe':
          return systemExecutable('System32\\cmd.exe', 'Windows command prompt')
        default:
          if (!/^[A-Za-z]:[\\/]/.test(shell)) {
            throw new Error('Custom Windows shells require a full executable path. Set the shell override to the installed .exe path.')
          }
          return executable(shell, 'Custom Windows shell')
      }
    },
  }
}

const windowsExecutables = createWindowsExecutableResolver()

export function resolveWslExecutable(platform: NodeJS.Platform = process.platform): HostExecutable {
  // Retain Linux-to-Windows interop for the opt-in tests run from inside WSL.
  return platform === 'win32' ? windowsExecutables.wsl() : { file: 'wsl.exe' }
}

export function resolveWindowsShell(configured?: string): string {
  return windowsExecutables.shell(configured)
}
