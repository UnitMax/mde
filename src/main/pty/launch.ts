import type { Project } from '@shared/types'

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
}

const DEFAULT_WINDOWS_SHELL = 'powershell.exe'
const DEFAULT_POSIX_SHELL = '/bin/bash'

/**
 * Builds the spawn command for a project. This is the seam a future OpenCode
 * integration slots into — nothing else needs to know how a shell is started.
 */
export function buildLaunchSpec(project: Project, context: LaunchContext): LaunchSpec {
  if (project.kind === 'wsl') {
    if (context.platform !== 'win32') {
      throw new Error('WSL projects can only be launched on Windows')
    }
    if (!project.distro) {
      throw new Error(`WSL project "${project.name}" has no distro`)
    }

    const shell = project.shell ?? 'bash'
    return {
      file: 'wsl.exe',
      args: [
        '-d',
        project.distro,
        '--cd',
        project.path,
        '--',
        shell,
        // A login+interactive shell is required: nvm/mise/bun/asdf put their
        // shims on PATH from the login profile, and a plain interactive shell
        // would leave those tools missing.
        '-lic',
        `exec ${shell} -i`
      ]
      // cwd is deliberately absent: --cd sets the working directory inside the
      // distro, and the Windows-side cwd is irrelevant (and must be a valid
      // Windows path, which project.path is not).
    }
  }

  if (context.platform === 'win32') {
    return {
      file: project.shell ?? DEFAULT_WINDOWS_SHELL,
      args: [],
      cwd: project.path
    }
  }

  return {
    file: project.shell ?? context.defaultShell ?? DEFAULT_POSIX_SHELL,
    args: ['-l'],
    cwd: project.path
  }
}
