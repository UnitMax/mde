import type { Session } from '@shared/types'

export interface LaunchSpec {
  file: string
  args: string[]
  /** Undefined means "let the PTY manager pick a safe default for the platform". */
  cwd?: string
}

/**
 * Everything about the host that the spec depends on, passed in explicitly so
 * the function stays pure and testable without spawning anything.
 */
export interface LaunchContext {
  platform: NodeJS.Platform
  /** process.env.SHELL on the host, if set. */
  defaultShell?: string
  /** Environment variables that should be inherited by native target shells. */
  environment?: Record<string, string>
  /** Environment variables that should be inherited by commands inside WSL. */
  wslEnvironment?: Record<string, string>
}

const DEFAULT_WINDOWS_SHELL = 'powershell.exe'
const DEFAULT_POSIX_SHELL = '/bin/bash'
const WSL_TERMINAL_ENVIRONMENT = {
  TERM: 'xterm-256color',
  COLORTERM: 'truecolor'
}

function wslEnvironmentArgs(environment: Record<string, string> | undefined): string[] {
  if (!environment) return []
  return Object.entries(environment)
    .filter(([key]) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(key))
    // These are argv entries to `env`, not shell source. Keeping each value as
    // one entry preserves spaces, quotes, and other path characters exactly.
    .map(([key, value]) => `${key}=${value}`)
}

/**
 * Builds the spawn command for a session. This is the seam a future OpenCode
 * integration slots into — nothing else needs to know how a shell is started.
 */
export function buildLaunchSpec(session: Session, context: LaunchContext): LaunchSpec {
  if (session.kind === 'wsl') {
    if (context.platform !== 'win32') {
      throw new Error('WSL sessions can only be launched on Windows')
    }
    if (!session.distro) {
      throw new Error(`WSL session "${session.name}" has no distro`)
    }

    const shell = session.shell ?? 'bash'
    const environment = wslEnvironmentArgs({
      ...context.environment,
      ...context.wslEnvironment,
      ...WSL_TERMINAL_ENVIRONMENT
    })
    return {
      file: 'wsl.exe',
      args: [
        '-d',
        session.distro,
        '--cd',
        session.path,
        '--',
        ...(environment.length > 0 ? ['env', ...environment, shell] : [shell]),
        // A login+interactive shell is required: nvm/mise/bun/asdf put their
        // shims on PATH from the login profile, and a plain interactive shell
        // would leave those tools missing.
        '-lic',
        `exec ${shell} -i`
      ]
      // cwd is deliberately absent: --cd sets the working directory inside the
      // distro, and the Windows-side cwd is irrelevant (and must be a valid
      // Windows path, which session.path is not).
    }
  }

  if (context.platform === 'win32') {
    return {
      file: session.shell ?? DEFAULT_WINDOWS_SHELL,
      args: [],
      cwd: session.path
    }
  }

  return {
    file: session.shell ?? context.defaultShell ?? DEFAULT_POSIX_SHELL,
    args: ['-l'],
    cwd: session.path
  }
}
